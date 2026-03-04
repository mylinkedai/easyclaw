/**
 * Startup timing preload script.
 *
 * Injected via NODE_OPTIONS="--require .../startup-timer.cjs" by the launcher.
 * Logs timestamps for key startup phases so we can see where time is spent.
 *
 * Output goes to stderr so it doesn't interfere with stdout protocol messages.
 */
"use strict";

const t0 = performance.now();
let requireCount = 0;
let requireTotalMs = 0;

function logPhase(label) {
  const elapsed = (performance.now() - t0).toFixed(0);
  process.stderr.write(`[startup-timer] +${elapsed}ms ${label}\n`);
}

logPhase("preload executing");

// ── Hook CJS Module._load to time slow requires ──
const Module = require("module");
const origLoad = Module._load;
const slowThresholdMs = 100; // Only log requires slower than 100ms

Module._load = function timedLoad(request, parent, isMain) {
  requireCount++;
  const start = performance.now();
  const result = origLoad.call(this, request, parent, isMain);
  const dur = performance.now() - start;
  requireTotalMs += dur;
  if (dur > slowThresholdMs) {
    // Shorten paths for readability
    const shortReq =
      request.length > 60 ? "..." + request.slice(-57) : request;
    logPhase(`require("${shortReq}") took ${dur.toFixed(0)}ms`);
  }
  return result;
};

// Log when the event loop starts processing (= all top-level ESM code done).
// The gap between "preload executing" and this line = CJS require + ESM loading.
setImmediate(() => {
  logPhase(
    `event loop started (${requireCount} requires, ${requireTotalMs.toFixed(0)}ms in CJS)`,
  );

  // Log periodic heartbeats so we can see what happens between event-loop
  // start and "listening on" (extension loading, config parsing, etc.)
  let heartbeat = 0;
  const iv = setInterval(() => {
    heartbeat++;
    logPhase(`heartbeat #${heartbeat} (still initializing)`);
    if (heartbeat >= 30) clearInterval(iv); // Stop after 30s
  }, 1000);
  // Don't keep the process alive just for heartbeats
  if (iv.unref) iv.unref();
});

// Log when the gateway starts listening (detect via stdout write)
const origStdoutWrite = process.stdout.write;
process.stdout.write = function (chunk, ...args) {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  if (str.includes("listening on")) {
    logPhase("gateway listening (READY)");
  }
  return origStdoutWrite.call(this, chunk, ...args);
};

// Log at process exit for total lifetime
process.on("exit", () => {
  logPhase("process exiting");
});
