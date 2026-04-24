#!/usr/bin/env node
// Transitional bootstrap shim. During the app split, keep new bootstrap logic
// out of this file and add it to app-specific entrypoints instead.
import { createLegacyProgram } from "./cli-programs";

createLegacyProgram().parse();
