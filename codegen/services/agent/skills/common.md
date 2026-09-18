# Common Patterns — Cross-Language Code Generation

These patterns apply regardless of target language.

## Separation of Concerns
- Ingestion (data loading) is independent of computation.
- Computation (engine) never does I/O directly.
- Output (writing) is independent of computation.
- Config centralizes all parameters — zero magic numbers in logic.

## Validation
- Validate inputs BEFORE processing (fail fast).
- Return clear error messages listing what's wrong.
- Never silently skip invalid data.

## Error Handling
- Use specific exceptions, not generic `Exception`.
- Log the error context (what input caused it).
- Let orchestrator decide whether to stop or continue.

## Logging
- Use structured logging (module-level logger).
- Log at INFO: start/end of pipeline stages.
- Log at WARNING: recoverable issues (missing optional fields).
- Log at ERROR: unrecoverable failures.

## Configuration
- All thresholds, file paths, connection strings in one config.
- Never hard-code values in computation logic.
- Use environment variables or config files for deployment.

## Testing
- One test file per computation module.
- Include boundary cases (zero, negative, max values).
- Include golden data tests (exact expected output).
- Tests should be runnable with a single command.

## File I/O — Excel
- Always specify the engine explicitly (openpyxl for .xlsx).
- Strip whitespace from column headers after reading.
- Validate expected columns exist before processing.
- Use context managers for write operations.

## Naming Conventions
- Files: snake_case (e.g., `exposure_calculator.py`)
- Classes: PascalCase
- Functions: snake_case
- Constants: UPPER_SNAKE_CASE
- Test files: `test_<module>.py`
