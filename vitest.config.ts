import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration.
 *
 * TEST TIMEOUT: the physics battery simulates real soft-body piles — a
 * dense-pile stress test runs 12 balls x 75 steps + 240 steps of the full
 * solver, and the stabilization diagnostics run several multi-second
 * scenarios. Measured in isolation:
 *
 *   stabilization-visual  > renders the dense-pile end state   6059 ms
 *   stabilization-diag    > S5: dense pile under sustained pressure  3717 ms
 *   stabilization-diag    > S3: rapid drops into an existing pile    3451 ms
 *   stabilization         > a settled mixed pile holds ...          2209 ms
 *   phase297              > particles stay inside the container ...  2114 ms
 *
 * Vitest's DEFAULT timeout is 5000 ms per test. The slowest test was
 * therefore only 6.8% under the limit in isolation — and under the full
 * suite (vitest runs the files in parallel, so the workers contend for
 * CPU) the dense-pile tests regularly exceeded 5 s and FAILED WITH
 * "Test timed out in 5000ms". That is a harness failure, not a
 * behavioural failure: the assertion never ran.
 *
 * Measured flake rate before the fix: ~1 in 3 full-suite runs, on
 * `phase297.test.ts > particles stay inside the container through
 * dense-pile stress` (and the same test at the pre-session commit
 * 394549a — this is NOT a regression from the perf work).
 *
 * 30 s gives the slowest measured test (6.1 s) a 5x margin under
 * contention, while still failing a genuinely hung test.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
