% presence_thresholds.m
% Derives the Araxia presence thresholds from the raw Fitbit Air captures.
%
% Reads capture/hr_worn_4.jsonl, capture/hr_offwrist.jsonl,
% capture/hr_rewear.jsonl (one JSON object per line: t, bpm, ...), then:
%   * measures packet cadence
%   * finds the longest run of identical BPM values per capture
%   * computes distinct-values-in-trailing-30s (the READY condition)
%   * shows where a naive "packets arriving" gate fails off-wrist
%   * plots all three series with the 8 s freeze gate overlaid
%
% Run from the repo root in MATLAB (R2020a+) or MATLAB Online:
%   >> cd analysis; presence_thresholds
% Writes capture/presence_thresholds.png and prints a summary table.
%
% Expected (from the captures committed 2026-09-12):
%   worn      longest run 7 pkts (~6 s), distinct30 min 5 / max 11
%   off-wrist longest run 167 pkts (~168 s), frozen at 112 from t=18.7 s
%   re-wear   first 21 pkts (~20 s) still carry the stale 112
% Threshold: STALE when the same value persists >= 8 s (above the worst
% worn plateau, far below the off-wrist freeze).

clear; clc;

root = fileparts(fileparts(mfilename('fullpath')));
if isempty(root), root = pwd; end
files = { 'hr_worn_4', 'worn'; 'hr_offwrist', 'off-wrist'; 'hr_rewear', 're-wear' };

FREEZE_S = 8;        % STALE after this many seconds of an identical value
WINDOW_S = 30;       % READY needs >= 2 distinct values in this trailing window
MIN_DISTINCT = 2;

summary = table('Size', [size(files,1) 8], ...
    'VariableTypes', {'string','double','double','double','double','double','double','double'}, ...
    'VariableNames', {'capture','packets','span_s','median_dt_s','longest_run_pkts','longest_run_s','distinct30_min','distinct30_max'});

figure('Color','w','Position',[100 100 1100 750]);
tl = tiledlayout(3,1,'TileSpacing','compact','Padding','compact');
title(tl, 'Fitbit Air 0x2A37 stream: worn vs off-wrist vs re-wear', 'FontWeight','bold');

for i = 1:size(files,1)
    [t, bpm] = readCapture(fullfile(root, 'capture', [files{i,1} '.jsonl']));
    dt = diff(t);

    [runLen, runStart, runEnd, runVal] = longestRun(t, bpm);
    distinct30 = trailingDistinct(t, bpm, WINDOW_S);
    ready = distinct30 >= MIN_DISTINCT;
    frozenFor = frozenSeconds(t, bpm);
    stale = frozenFor >= FREEZE_S;

    summary(i,:) = { string(files{i,2}), numel(bpm), t(end)-t(1), median(dt), ...
                     runLen, runEnd-runStart, min(distinct30(11:end)), max(distinct30) };

    nexttile; hold on; grid on;
    plot(t, bpm, '-', 'LineWidth', 1.2, 'Color', [0.15 0.35 0.75]);
    % shade STALE regions
    yl = [min(bpm)-3, max(bpm)+3];
    shadeMask(t, stale, yl, [0.85 0.25 0.25]);
    % mark the longest identical run
    plot([runStart runEnd], [runVal runVal], 'r-', 'LineWidth', 3);
    text(runStart, runVal + 1.2, sprintf('longest identical run: %d pkts / %.1f s', runLen, runEnd-runStart), ...
        'Color','r','FontSize',9);
    ylim(yl); xlabel('seconds'); ylabel('BPM');
    title(sprintf('%s   (READY %.0f%% of packets under variation gate; naive "connected" gate would say 100%%)', ...
        files{i,2}, 100*mean(ready)));
    hold off;
end

exportgraphics(gcf, fullfile(root, 'capture', 'presence_thresholds.png'), 'Resolution', 150);

disp(summary);
fprintf('\nFreeze gate = %d s. Worst worn plateau = %.1f s. Off-wrist freeze = %.1f s.\n', ...
    FREEZE_S, summary.longest_run_s(1), summary.longest_run_s(2));
fprintf('Margin above worn: %.1f s. Off-wrist would stay READY forever under a packet-arrival gate.\n', ...
    FREEZE_S - summary.longest_run_s(1));

% ---------------------------------------------------------------------
function [t, bpm] = readCapture(path)
    txt = fileread(path);
    lines = strsplit(strtrim(txt), newline);
    n = numel(lines); t = zeros(n,1); bpm = zeros(n,1);
    for k = 1:n
        row = jsondecode(lines{k});
        t(k) = row.t; bpm(k) = row.bpm;
    end
end

function [bestLen, bestStart, bestEnd, bestVal] = longestRun(t, v)
    bestLen = 1; bestStart = t(1); bestEnd = t(1); bestVal = v(1);
    s = 1;
    for k = 2:numel(v)+1
        if k > numel(v) || v(k) ~= v(s)
            len = k - s;
            if len > bestLen
                bestLen = len; bestStart = t(s); bestEnd = t(k-1); bestVal = v(s);
            end
            s = k;
        end
    end
end

function d = trailingDistinct(t, v, win)
    d = zeros(size(v));
    for k = 1:numel(v)
        m = t > t(k) - win & t <= t(k);
        d(k) = numel(unique(v(m)));
    end
end

function f = frozenSeconds(t, v)
    % seconds since the value last changed, per packet
    f = zeros(size(v)); lastChange = t(1);
    for k = 2:numel(v)
        if v(k) ~= v(k-1), lastChange = t(k); end
        f(k) = t(k) - lastChange;
    end
end

function shadeMask(t, mask, yl, color)
    if ~any(mask), return; end
    edges = diff([0; mask(:); 0]);
    starts = find(edges == 1); ends = find(edges == -1) - 1;
    for j = 1:numel(starts)
        x0 = t(starts(j)); x1 = t(ends(j));
        patch([x0 x1 x1 x0], [yl(1) yl(1) yl(2) yl(2)], color, 'FaceAlpha', 0.12, 'EdgeColor', 'none');
    end
end
