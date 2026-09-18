"""
QUESTION IT ANSWERS: "How do the fixes connect as a system?"

PURPOSE:
Takes the winning solution approach from Agent 3 (which evaluated
multiple options before recommending one) and arranges its components
into a layered system architecture.

This version asks the model for a structured JSON diagram spec instead
(layers, components per layer, connections between them), which a
dedicated renderer (diagram_renderer.py) turns into a proper layered
architecture diagram - colored layer containers, named components, and
labeled connections (including exception paths drawn distinctly). The
same rendering approach is generalized to work for any client's solution.
"""

import re
from typing import List, Optional
from pydantic import BaseModel, Field
from ...ai_client import generate


SYSTEM_INSTRUCTION = """You are a solutions architect.

You are given:
- The original process breakdown (Agent 1)
- The gap and risk analysis (Agent 2)
- A solution design that includes multiple evaluated options, a recommended
  winning approach with named components, and a Technical Implementation
  Approach (named tech stack, code structure) for that winning approach
  (Agent 3)

Your job: Design the system architecture for the RECOMMENDED/WINNING
approach ONLY, using the SAME named technologies/components Agent 3 already
committed to (don't invent different generic ones). Ignore rejected
alternative options entirely.

Use the gap analysis to ensure exception paths cover specific control gaps
identified, and that an audit/logging layer addresses compliance issues found.

Think like a real solutions architect diagramming this for a client deck:
- Group components into clear layers (e.g. Input, Validation/Processing,
  Integration, Output, Audit/Monitoring) - use layer names that fit THIS
  specific solution, not necessarily these exact ones.
- Name every component specifically (the real tool/service from Agent 3's
  tech stack), never generic placeholders like "Process" or "System A".
- Show the happy path AND at least one exception/error path.
- Show real integration points to existing systems named in the process
  breakdown or gap analysis.

OUTPUT FORMAT - produce BOTH parts below, in this order:

PART 1 - a fenced JSON block (this powers the actual diagram rendering,
must be valid JSON, use short lowercase snake_case ids for components):

```json
{
  "layers": ["<Layer 1 name>", "<Layer 2 name>", "..."],
  "components": [
    {"id": "<short_id>", "name": "<Real Component Name (Real Tech)>", "layer": "<must match a layer name above>"},
    ...
  ],
  "connections": [
    {"source": "<component id>", "target": "<component id>", "label": "<optional short label, e.g. Valid>", "kind": "normal"},
    {"source": "<component id>", "target": "<component id>", "label": "<optional label, e.g. Invalid>", "kind": "exception"}
  ]
}
```

Rules for the JSON:
- Every component's "layer" must exactly match one of the strings in "layers"
- Every connection's source/target must exactly match a component "id"
- Use "kind": "exception" only for error/exception/retry paths; everything
  else is "normal"
- Include at least one "exception" connection if the process has any
  validation, approval, or error-handling step - if genuinely none applies,
  omit exception connections entirely rather than inventing one
- 6-14 components total is typical - enough to be technical, not so many
  it becomes unreadable

PART 2 - after the JSON block, plain markdown with these sections:

## 🏗️ Architecture Design

### Layer Breakdown
| Layer | Components | Data In | Data Out |
|---|---|---|---|
| <layer> | <real components in this layer> | <real data> | <real data> |

(one row per layer, in the same order as the JSON "layers" list)

### Data Flow
**Happy Path:**
<numbered steps in plain English, naming the real components in order>

**Exception Path:**
<numbered steps in plain English for the error/exception route, or write
"Not applicable - no exception handling required for this approach" if
there are genuinely no exception connections>

### Integration Points
| System | Connection Type | Purpose |
|---|---|---|
| <real existing system, from the process breakdown> | <API/ETL/Direct/File> | <real purpose> |
"""


class Component(BaseModel):
    id: str = Field(description="short snake_case identifier")
    name: str = Field(description="real, specific component name including the actual technology")
    layer: str = Field(description="must exactly match one entry in the layers list")


class Connection(BaseModel):
    source: str
    target: str
    label: Optional[str] = None
    kind: str = "normal"


class ArchitectureSpec(BaseModel):
    """Structured diagram spec - the actual input to diagram_renderer.py."""
    layers: List[str]
    components: List[Component]
    connections: List[Connection]


_JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)


def run(structured_process: str, solution_components: str, gap_analysis: str = "") -> str:
    """
    Returns the RAW output (JSON diagram spec block + markdown sections).
    Callers should use parse_architecture() to split this into the clean
    display text and structured diagram spec.
    """
    prompt = (
        f"Original process breakdown:\n{structured_process}\n\n"
        f"Gap and Risk Analysis:\n{gap_analysis}\n\n"
        f"Solution Design (use ONLY the RECOMMENDED approach's components "
        f"and tech stack; ignore rejected alternatives):\n"
        f"{solution_components}\n"
    )
    return generate(prompt=prompt, system_instruction=SYSTEM_INSTRUCTION)


def parse_architecture(raw_output: str):
    """
    Splits Agent 4's raw output into:
      - display_text: markdown with the JSON block removed
      - diagram_spec: validated dict ready for the diagram renderer

    If the JSON block is missing or invalid, diagram_spec is None.
    """
    json_match = _JSON_BLOCK_RE.search(raw_output)

    if not json_match:
        return raw_output.rstrip(), None

    display_text = (
        raw_output[:json_match.start()]
        + raw_output[json_match.end():]
    ).strip()

    try:
        spec = ArchitectureSpec.model_validate_json(json_match.group(1))
        diagram_spec = spec.model_dump()
    except Exception:
        diagram_spec = None

    return display_text, diagram_spec
