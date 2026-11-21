function classifyRetry(original, again) {
  if (!original || original.status !== 'timedOut') return original;
  const duration = (original.duration_ms || 0) + (again && again.duration_ms || 0);
  if (again && again.status === 'passed') return Object.assign({}, again, { duration_ms: duration });
  return Object.assign({}, original, { status: 'infra_error', duration_ms: duration });
}

module.exports = { classifyRetry };
