# Python Skill — Code Generation Patterns

## Project Structure

```text
<project_root>/
├── __init__.py
├── config.py              # thresholds, paths, source/target settings
├── schemas.py             # Pydantic models + column-name lists
├── ingestion/
│   ├── __init__.py
│   ├── base.py            # Abstract DataLoader interface
│   ├── excel_loader.py    # Excel adapter (openpyxl / pandas)
│   ├── api_loader.py      # REST API adapter (stub)
│   ├── db_loader.py       # Database adapter (stub)
│   └── validator.py       # Input validation against schemas
├── engine/
│   ├── __init__.py
│   └── <rule>.py          # One module per transformation rule
│                          # (include any summarization logic here as well,
│                          #  separately)
├── output/
│   ├── __init__.py
│   ├── base.py            # Abstract DataWriter interface
│   ├── excel_writer.py    # Excel writer (openpyxl / pandas)
│   ├── api_writer.py      # REST API adapter (stub)
│   └── db_writer.py       # Database adapter (stub)
├── main.py                # Orchestrator: load → validate → compute → write
├── tests/
│   ├── __init__.py
│   └── test_<rule>.py     # Tests per computation rule with golden data
├── requirements.txt       # List dependencies required for code:
│                          # pandas, openpyxl, pydantic, pytest, etc.
└── README.md              # Explain overall project structure, how to run
                           # the code, and how to run tests
```

## Python Version & Style
- Target Python 3.10+
- Use type hints on all function signatures
- Use `|` union syntax (not `Union`)
- Use `match-case` where appropriate
- Use dataclasses or Pydantic models for structured data

## Dependencies (standard choices)
- `pandas` — DataFrame operations
- `openpyxl` — Excel read/write engine
- `pydantic` — schema validation models
- `pytest` — testing framework

## Configuration Pattern

```python
# config.py — centralized, no magic numbers elsewhere
from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
    input_path: str = "data/input.xlsx"
    output_path: str = "data/output.xlsx"
    threshold_value: float = 0.05
    # ... all thresholds from spec

config = Config()
```

## Excel Read Pattern

```python
import pandas as pd

def read_excel_sheet(path: str, sheet_name: str) -> pd.DataFrame:
    """Read a single sheet, strip whitespace from column names."""
    df = pd.read_excel(path, sheet_name=sheet_name, engine="openpyxl")
    df.columns = df.columns.str.strip()
    return df
```

## Excel Write Pattern

```python
def write_excel(
    df: pd.DataFrame,
    path: str,
    sheet_name: str = "Sheet1",
) -> None:
    """Write DataFrame to Excel with auto-column-width."""
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
```

## Validation Pattern

```python
from schemas import ExpectedColumns

def validate_input(
    df: pd.DataFrame,
    expected: list[str],
) -> list[str]:
    """Return list of missing columns (empty = valid)."""
    missing = [c for c in expected if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    return missing
```

## Engine / Computation Pattern

```python
# engine/<rule>.py — pure function, no side effects
import pandas as pd
from config import config

def calculate_exposure(df: pd.DataFrame) -> pd.DataFrame:
    """Apply exposure calculation rule per spec section X."""
    result = df.copy()
    result["exposure"] = result["notional"] * result["weight"]
    result["flagged"] = result["exposure"] > config.threshold_value
    return result
```

## Testing Pattern

```python
# tests/test_exposure.py
import pytest
import pandas as pd
from engine.exposure import calculate_exposure

def test_basic_exposure() -> None:
    df = pd.DataFrame({"notional": [100], "weight": [0.5]})
    result = calculate_exposure(df)
    assert result["exposure"].iloc[0] == 50.0

def test_threshold_flag() -> None:
    df = pd.DataFrame({"notional": [1000], "weight": [0.1]})
    result = calculate_exposure(df)
    assert result["flagged"].iloc[0] == True
```
