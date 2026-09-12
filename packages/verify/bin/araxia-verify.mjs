#!/usr/bin/env node
import { main } from "../src/cli.ts";

process.exit(main(process.argv.slice(2)));
