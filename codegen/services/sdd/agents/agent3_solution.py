"""
QUESTION IT ANSWERS: "What should fix, and what are the options?"
"""

import re
from pydantic import BaseModel, Field
from ...ai_client import generate


SYSTEM_INSTRUCTION = """You are a senior solutions architect consultant.

You are given a structured business process and a gap/risk analysis.
Your job is to:
1. Identify 2-3 distinct solution approaches that could address the gaps
2. Compare them objectively across key dimensions
3. Recommend the best fit with clear reasoning
4. Detail the winning approach's specific components

APPROACH TYPES TO CONSIDER (pick 2-3 most relevant for this domain):
- Workflow Automation (e.g. Power Automate, Azure Logic Apps)
- System Integration & API Layer (connecting existing systems)
- Full Platform Replacement (new ERP/system)
- AI/ML Enhancement (adding intelligence to existing process)
- Low-Code/RPA (UiPath, Power Platform)
- Custom Development (bespoke application)
- Hybrid Approach (combination of above)

For each approach, evaluate against these dimensions:
- Implementation Complexity: Low / Medium / High
- Time to Value: Quick (weeks) / Medium (months) / Long (6+ months)
- Cost Estimate: Low / Medium / High
- Risk Level: Low / Medium / High
- Addresses All Critical Gaps: Yes / Partial / No
- Scalability: Low / Medium / High

Rules:
- Base approach options on the SPECIFIC gaps and domain identified
- Do NOT invent generic approaches - tie each to actual gaps found
- The recommended approach must be clearly justified against the others
- Components must be named specifically, not generically
- Do NOT describe architecture or data flow yet - that is Agent 4's job

Output in EXACTLY this markdown format:

## 💡 Solution Design

---

### 🔵 Solution Options Evaluated

### Option 1: <Approach Name>
> <One sentence description of this approach>

**Key Technologies:** <name specific tools/libraries/services - not generic categories>

**How it addresses the gaps:**
- <specific gap> → <show how this option addresses it>
- <specific gap> → <show how this option addresses it>

**Tradeoffs:**
- 🟩 <strength>
- 🟩 <strength>
- ❌ <weakness>
- ❌ <weakness>

---

### Option 2: <Approach Name>
> <One sentence description of this approach>

**Key Technologies:** <name specific tools/libraries/services - not generic categories>

**How it addresses the gaps:**
- <specific gap> → <show how this option addresses it>

**Tradeoffs:**
- 🟩 <strength>
- ❌ <weakness>

---

### Option 3: <Approach Name> *(if applicable)*
> <one sentence description>

**Key Technologies:** <name specific tools/libraries/services - not generic categories>

**How it addresses the gaps:**
- <specific gap> → <show how this option addresses it>

**Tradeoffs:**
- 🟩 <strength>
- ❌ <weakness>

---

### 📊 Options Comparison Matrix

| Dimension | Option 1: <name> | Option 2: <name> | Option 3: <name> |
|---|---|---|---|
| Implementation Complexity | Low/Medium/High | Low/Medium/High | Low/Medium/High |
| Time to Value | Quick/Medium/Long | Quick/Medium/Long | Quick/Medium/Long |
| Cost Estimate | Low/Medium/High | Low/Medium/High | Low/Medium/High |
| Risk Level | Low/Medium/High | Low/Medium/High | Low/Medium/High |
| Addresses All Critical Gaps | Yes/Partial/No | Yes/Partial/No | Yes/Partial/No |
| Scalability | Low/Medium/High | Low/Medium/High | Low/Medium/High |

---

### ✅ Recommended Approach: <Winning Option Name>

**Why this over the alternatives:**
<3-4 sentences explaining specifically why this option fits better than the others
for THIS process and domain - reference actual gaps, constraints, and
the comparison matrix above>

**Recommended Approach:** <one-line approach name>

**Reasoning:** <2-3 sentences tying approach to specific gaps and domain>

### 🧩 Solution Components

| # | Component | Gap Addressed | How It Works |
|---|---|---|---|
| 1 | **<Component Name>** | <exact gap> | <brief description> |
| 2 | **<Component Name>** | <exact gap> | <brief description> |
| 3 | **<Component Name>** | <exact gap> | <brief description> |
(name specific, real components for THIS approach only)

---

### 🛠️ Technical Implementation Approach

**Suggested Tech Stack**

| Layer | Tool / Library | Purpose |
|---|---|---|
| <layer, e.g. Backend> | <specific named tool/library> | <why this one> |
| <layer> | <specific named tool/library> | <why this one> |
(list every layer needed for THIS approach - be specific: real package/service names, not "a database" or "some framework")

**Suggested Code / Module Structure**

< a short file/folder tree for the core new components - real filenames,
one line each, e.g. >

project/
  agents/
    validation_agent.py
    routing_service.py
  api/
    endpoints.py
  models/
    schema.py

**Core Logic - Starter Snippet**
```python
<a short (10-25 line) realistic code snippet in the most relevant language
for this approach, showing the CENTRAL piece of logic a developer would
start with. Real syntax, not pseudocode where possible. Keep it short and
focused on ONE key piece, not the whole system.>
```

**APIs / Data Contracts** *(only if this approach involves an API or defined data exchange)*

| Endpoint / Contract | Method | Purpose | Key Fields |
|---|---|---|---|
| <endpoint or data object> | <GET/POST/etc., or "N/A"> | <what it does> | <field1, field2, ...> |

---

### 🔗 Integration Requirements

| Existing System | Integration Purpose | Connection Type |
|---|---|---|
| <system> | <why> | <API/ETL/Direct/File> |

---

### 📅 Implementation Phasing

#### 🚀 Phase 1 - Quick Wins (Week 1-2)
> Highest-risk gaps first
- 🟩 <component>: <what it fixes>

#### ⚙️ Phase 2 - Core Automation (Week 3-6)
> Replace manual steps
- 🟩 <component>: <what it fixes>

#### 🚀 Phase 3 - Advanced (Week 7+)
> Intelligence and scalability
- 🟩 <component>: <what it fixes>

---

### 📈 Expected Impact

| Gap Addressed | Before | After |
|---|---|---|
| <gap> | <current state> | <future state> |

"""

# The model output above is intentionally followed by a machine-readable JSON
# block so the human-in-the-loop UI can select a confirmed option safely.

DETAIL_SYSTEM_INSTRUCTION = """You are a senior solutions architect consultant.

Earlier, you evaluated 2-3 solution approaches for a business process and
recommended one approach. A consultant has now reviewed all the options and
CONFIRMED one approach that may be DIFFERENT from the original recommendation.
Your job now is to produce the detailed, component-level design for the
CONFIRMED approach ONLY (ignore which one you originally recommended - that
recommendation is no longer relevant).

Output EXACTLY this markdown format, nothing else (no preamble, no repeated
option comparison - that has already been shown separately):

### ✅ Confirmed Approach: <Confirmed Approach Name / selected option name by consultant>

**Why this approach:** <2-3 sentences grounded in the approach's own
description/tradeoffs given below and the gap analysis - do not reference
any other approach>

### 🧩 Solution Components

| # | Component | Gap Addressed | How It Works |
|---|---|---|---|
| 1 | **<Component Name>** | <exact gap> | <brief description> |
| 2 | **<Component Name>** | <exact gap> | <brief description> |
| 3 | **<Component Name>** | <exact gap> | <brief description> |
(name specific, real components for THIS approach only)

---

### 🛠️ Technical Implementation Approach

**Suggested Tech Stack**

| Layer | Tool / Library | Purpose |
|---|---|---|
| <layer, e.g. Backend> | <specific named tool/library> | <why this one> |
| <layer> | <specific named tool/library> | <why this one> |
(list every layer needed for THIS approach - be specific: real package/service names, not "a database" or "some framework")

**Suggested Code / Module Structure**

< a short file/folder tree for the core new components - real filenames,
one line each >

**Core Logic - Starter Snippet**
```python
<a short (10-25 line) realistic code snippet in the most relevant language
for this approach, showing the CENTRAL piece of logic a developer would
start with. Real syntax, not pseudocode where possible. Keep it short and
focused on ONE key piece, not the whole system.>
```

**APIs / Data Contracts** *(only if this approach involves an API or defined data exchange)*

| Endpoint / Contract | Method | Purpose | Key Fields |
|---|---|---|---|
| <endpoint or data object> | <GET/POST/etc., or "N/A"> | <what it does> | <field1, field2, ...> |

---

### 🔗 Integration Requirements

| Existing System | Integration Purpose | Connection Type |
|---|---|---|
| <system> | <why> | <API/ETL/Direct/File> |

---

### 📅 Implementation Phasing

#### 🚀 Phase 1 - Quick Wins (Week 1-2)
> Highest-risk gaps first
- 🟩 <component>: <what it fixes>

#### ⚙️ Phase 2 - Core Automation (Week 3-6)
> Replace manual steps
- 🟩 <component>: <what it fixes>

#### 🚀 Phase 3 - Advanced (Week 7+)
> Intelligence and scalability
- 🟩 <component>: <what it fixes>

---

### 📈 Expected Impact

| Gap Addressed | Before | After |
|---|---|---|
| <gap> | <current state> | <future state> |
"""


class OptionsSummary(BaseModel):
    """Machine-readable summary of Agent 3's options, used only for HITL selection."""

    options: list[str] = Field(
        description="Names of the 2-3 solution options, in the order presented"
    )
    recommended: str = Field(
        description="Exact name of the AI-recommended option, matching one entry in options"
    )


_OPTION_HEADING_RE = re.compile(
    r"^###\s+Option\s+(\d+)\s*:\s*(.+?)\s*$",
    re.MULTILINE,
)

_JSON_BLOCK_RE = re.compile(
    r"```json\s*(\{.*?\})\s*```",
    re.DOTALL,
)

RECOMMENDED_SECTION_MARKER = "### ✅ Recommended Approach:"


def run(structured_process: str, gap_analysis: str) -> str:
    """
    Returns the raw output (markdown + trailing JSON summary block).
    """
    prompt = (
        f"Structured business process:\n{structured_process}\n\n"
        f"Gap and risk analysis:\n{gap_analysis}\n"
    )
    return generate(prompt=prompt, system_instruction=SYSTEM_INSTRUCTION)


def parse_options(raw_output: str):
    """
    Splits Agent 3's raw output into:
      - display_text: the human-readable markdown, WITHOUT the trailing JSON block
      - json_block: parsed structured option data when available
      - options: dict {"Option 1": {"name": "...", "recommended": bool, "summary": "..."}, ...}
      - recommended_key: which key ("Option 1"/"Option 2"/"Option 3") the UI should select by default

    If parsing fails, keep the pipeline usable with a single safe default option.
    """
    json_match = _JSON_BLOCK_RE.search(raw_output)
    display_text = (
        raw_output[: json_match.start()].rstrip()
        if json_match
        else raw_output.rstrip()
    )

    names_in_order = []
    recommended_name = None

    if json_match:
        try:
            parsed = OptionsSummary.model_validate_json(json_match.group(1))
            names_in_order = parsed.options
            recommended_name = parsed.recommended
        except Exception:
            pass  # fall through to regex fallback below

    if not names_in_order:
        heading_matches = _OPTION_HEADING_RE.findall(display_text)
        names_in_order = [
            name.replace("*(if applicable)*", "").strip()
            for _, name in heading_matches
        ]

    if not names_in_order:
        # Total parsing failure (e.g. offline placeholder text) - keep the
        # pipeline usable with a single safe default option.
        return (
            display_text,
            {
                "Option 1": {
                    "name": "Option 1",
                    "recommended": True,
                    "summary": display_text,
                }
            },
            "Option 1",
        )

    options = {}
    recommended_key = None
    heading_positions = list(_OPTION_HEADING_RE.finditer(display_text))
    matrix_pos = display_text.find("### 📊 Options Comparison Matrix")

    for idx, name in enumerate(names_in_order, start=1):
        key = f"Option {idx}"
        is_recommended = bool(
            recommended_name
            and recommended_name.strip().lower() == name.strip().lower()
        )

        summary = name
        if idx - 1 < len(heading_positions):
            start = heading_positions[idx - 1].start()
            end = (
                heading_positions[idx].start()
                if idx < len(heading_positions)
                else (matrix_pos if matrix_pos != -1 else len(display_text))
            )
            summary = display_text[start:end].strip().rstrip("-").strip()

        options[key] = {
            "name": name,
            "recommended": is_recommended,
            "summary": summary,
        }

        if is_recommended:
            recommended_key = key

    if recommended_key is None:
        # Recommended name didn't exactly match any option (rare) - default to first.
        recommended_key = "Option 1"
        options[recommended_key]["recommended"] = True

    return display_text, options, recommended_key


def generate_option_details(
    structured_process: str,
    gap_analysis: str,
    option_name: str,
    option_summary: str,
) -> str:
    prompt = (
        f"Structured business process:\n{structured_process}\n\n"
        f"Gap and risk analysis:\n{gap_analysis}\n\n"
        f"Confirmed approach the consultant selected: {option_name}\n\n"
        f"That approach's own description/tradeoffs, as originally evaluated:\n"
        f"{option_summary}\n"
    )
    return generate(prompt=prompt, system_instruction=DETAIL_SYSTEM_INSTRUCTION)
