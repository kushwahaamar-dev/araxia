import { afterEach, describe, expect, it } from "vitest";
import {
  fitbitAuthorizeUrl,
  getFitbitSnapshot,
  invalidateFitbit,
  parseBreathing,
  parseDailyRestingBpm,
  parseDisplayName,
  parseHrv,
  parseLatestHeartRate,
  parseSkinTemp,
  parseSleep,
  parseSpo2,
  parseStepsRollup,
} from "../src/lib/fitbit";

const saved = {
  id: process.env.GOOGLE_HEALTH_CLIENT_ID,
  secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
  access: process.env.GOOGLE_HEALTH_ACCESS_TOKEN,
  refresh: process.env.GOOGLE_HEALTH_REFRESH_TOKEN,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  invalidateFitbit();
  restore("GOOGLE_HEALTH_CLIENT_ID", saved.id);
  restore("GOOGLE_HEALTH_CLIENT_SECRET", saved.secret);
  restore("GOOGLE_HEALTH_ACCESS_TOKEN", saved.access);
  restore("GOOGLE_HEALTH_REFRESH_TOKEN", saved.refresh);
});

describe("Google Health API parsers", () => {
  it("reads latest heart-rate sample and daily resting BPM", () => {
    expect(
      parseLatestHeartRate({
        dataPoints: [
          { heartRate: { beatsPerMinute: "70", sampleTime: { physicalTime: "2026-09-13T10:00:00Z" } } },
          { heartRate: { beatsPerMinute: "88", sampleTime: { physicalTime: "2026-09-13T10:04:00Z" } } },
        ],
      }),
    ).toBe(88);
    expect(
      parseDailyRestingBpm({
        dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "62" } }],
      }),
    ).toBe(62);
  });

  it("reads overnight and daily summaries", () => {
    expect(
      parseSkinTemp({
        dataPoints: [
          {
            dailySleepTemperatureDerivations: {
              nightlyTemperatureCelsius: 34.5,
              baselineTemperatureCelsius: 34.2,
            },
          },
        ],
      }),
    ).toContain("+0.30");
    expect(
      parseHrv({
        dataPoints: [{ dailyHeartRateVariability: { averageHeartRateVariabilityMilliseconds: 45.12 } }],
      }),
    ).toContain("45.1");
    expect(
      parseSpo2({
        dataPoints: [{ dailyOxygenSaturation: { averagePercentage: 97.4 } }],
      }),
    ).toContain("97.4");
    expect(
      parseBreathing({
        dataPoints: [{ dailyRespiratoryRate: { breathsPerMinute: 14.8 } }],
      }),
    ).toContain("14.8");
    expect(
      parseSleep({
        dataPoints: [{ sleep: { summary: { minutesAsleep: "421" } } }],
      }),
    ).toContain("7 h");
    expect(parseStepsRollup({ rollupDataPoints: [{ steps: { countSum: "4500" } }] })).toBe("4500 steps");
    expect(parseDisplayName({ healthUserId: "h_amar", legacyUserId: "ABC" })).toBe("ABC");
  });

  it("returns null on empty Google Health payloads", () => {
    expect(parseLatestHeartRate({})).toBeNull();
    expect(parseSkinTemp({ dataPoints: [] })).toBeNull();
    expect(parseHrv({})).toBeNull();
    expect(parseStepsRollup({})).toBeNull();
  });
});

describe("Google Health API client", () => {
  it("authorizes against Google OAuth, not Fitbit", () => {
    process.env.GOOGLE_HEALTH_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_HEALTH_CLIENT_SECRET = "sec";
    const url = fitbitAuthorizeUrl();
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("access_type=offline");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly"));
    expect(url).not.toContain("fitbit.com");
  });

  it("fetches v4 data types on health.googleapis.com", async () => {
    process.env.GOOGLE_HEALTH_CLIENT_ID = "cid.apps.googleusercontent.com";
    process.env.GOOGLE_HEALTH_CLIENT_SECRET = "sec";
    process.env.GOOGLE_HEALTH_ACCESS_TOKEN = "tok";
    process.env.GOOGLE_HEALTH_REFRESH_TOKEN = "ref";
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/identity")) {
        return new Response(JSON.stringify({ healthUserId: "h_amar" }), { status: 200 });
      }
      if (url.includes("heart-rate/dataPoints") && !url.includes("daily-resting")) {
        return new Response(
          JSON.stringify({
            dataPoints: [{ heartRate: { beatsPerMinute: "88", sampleTime: { physicalTime: "2026-09-13T10:00:00Z" } } }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("daily-resting-heart-rate")) {
        return new Response(JSON.stringify({ dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: "62" } }] }), {
          status: 200,
        });
      }
      if (url.includes("dailyRollUp")) {
        return new Response(JSON.stringify({ rollupDataPoints: [{ steps: { countSum: "1200" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ dataPoints: [] }), { status: 200 });
    };

    const snap = await getFitbitSnapshot(72, fetchImpl, Date.parse("2026-09-13T12:00:00Z"));
    expect(snap.source).toBe("google-health-api");
    expect(snap.live_gate).toBe("ble-packets");
    expect(snap.live_ble_bpm).toBe(72);
    expect(snap.cloud_latest_intraday_bpm).toBe(88);
    expect(snap.cloud_resting_bpm).toBe(62);
    expect(snap.display_name).toBe("h_amar");
    expect(snap.metrics.find((m) => m.key === "steps")?.value).toBe("1200 steps");
    expect(urls.some((u) => u.startsWith("https://health.googleapis.com/v4/"))).toBe(true);
    expect(urls.some((u) => u.includes("/dataTypes/heart-rate/dataPoints"))).toBe(true);
    expect(urls.some((u) => decodeURIComponent(u).includes("heart_rate.sample_time.physical_time"))).toBe(true);
    expect(urls.some((u) => decodeURIComponent(u).includes("daily_resting_heart_rate.date"))).toBe(true);
    expect(urls.every((u) => !u.includes("api.fitbit.com") && !u.includes("www.fitbit.com"))).toBe(true);
  });
});
