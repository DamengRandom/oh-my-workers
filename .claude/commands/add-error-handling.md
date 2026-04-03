# /add-error-handling

When adding error handling to any agent call or job in this project, follow this exact pattern:

## Rules

**1. Wrap every `agent.invoke()` in try/catch**
```typescript
try {
  const result = await someAgent.invoke({ ... })
  // use result
} catch (err) {
  console.error('❌ [AgentName] failed:', err instanceof Error ? err.message : err)
  await WorkCoordinator.notifyError('[AgentName]', err)
  // decide: return early (critical) or continue (non-critical)
}
```

**2. Use `Promise.allSettled` — never `Promise.all` — for parallel agents**
```typescript
const [aSettled, bSettled] = await Promise.allSettled([agentA.invoke(...), agentB.invoke(...)])

if (aSettled.status === 'rejected') {
  console.error('❌ Agent A failed:', aSettled.reason)
  await WorkCoordinator.notifyError('Agent A', aSettled.reason)
}
// continue regardless — don't let one failure cancel the other
```

**3. Wrap all DB calls in try/catch**
```typescript
try {
  await saveSomething({ ... })
} catch (err) {
  console.error('❌ Failed to save [what]:', err instanceof Error ? err.message : err)
  await WorkCoordinator.notifyError('save[What]', err)
}
```

**4. Classify failures as critical or non-critical**
- **Critical** (abort with `return` after notifying): missing required data, generator failed, GitHub fetch failed
- **Non-critical** (log, notify, continue): cleanup failed, one delivery channel failed, DB save failed

**5. Never notify via a broken channel**
- If Telegram delivery failed, don't try to send the error notification via Telegram
- If both channels failed, just log to console — do not re-throw

## `notifyError` signature
```typescript
private static async notifyError(context: string, error: unknown): Promise<void>
```
Already implemented in `WorkCoordinator`. Always call `await WorkCoordinator.notifyError(...)` — it never throws.

## What NOT to do
- Do not use bare `Promise.all` for parallel agent invocations
- Do not swallow errors silently (always `console.error` at minimum)
- Do not throw from inside `notifyError`
- Do not add retry logic inside individual error handlers — retries belong in the pipeline orchestration
