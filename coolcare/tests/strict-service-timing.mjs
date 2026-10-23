// Local walkthrough settings must not silently relax regression tests.
// Test-mode scenarios explicitly enable the flag and restore it afterwards.
process.env.SERVICE_TIMING_TEST_MODE = 'false';
