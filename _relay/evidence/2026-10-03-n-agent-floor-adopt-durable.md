# Floor cancel + adoptDurable (2026-10-03)

1. Floor/health-strip could write Hermes patches after effect cancel / remount on seats churn
2. GET ownership-mismatch always cleared hydrating seat FK — multi-instance stale Map destroyed rightful durable bind

Fixes: cancel-before-write + deps [actions]; adoptDurableComputerBinding when no other snapshot seat claims computer_id.
