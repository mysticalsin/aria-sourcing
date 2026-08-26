/**
 * Unit tests for analytics metric parsing / formatting helpers used by
 * animated dashboard tiles (Command Center + Exec).
 */
import assert from "node:assert/strict";
import { formatAnimatedMetric, parseMetricNumber } from "../src/lib/dashboard-motion.ts";

assert.equal(parseMetricNumber(42), 42);
assert.equal(parseMetricNumber("1,234"), 1234);
assert.equal(parseMetricNumber("45%"), 45);
assert.equal(parseMetricNumber("12.5h"), 12.5);
assert.equal(parseMetricNumber("—"), null);
assert.equal(parseMetricNumber("Not tracked yet"), null);

assert.equal(formatAnimatedMetric(100, 42), "42");
assert.equal(formatAnimatedMetric("1,234", 1234), "1,234");
assert.equal(formatAnimatedMetric("45%", 44.6), "45%");
assert.equal(formatAnimatedMetric("12.5h", 12.5), "12.5h");

console.log("dashboard-motion: ok");
