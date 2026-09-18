"""
PURPOSE:
This is the "brain" of the pipeline. It takes the user's raw process
description and runs it through the 5 agents in sequence, passing each
agent's output forward as the next agent's input.

HITL- The pipeline stops after Agent 3 so the consultant can review the 3
solution options and confirm (or override) which one to proceed with.

run_phase1() -> Agents 1, 2, 3. Returns process breakdown, gap analysis,
               the clean solution-design text, the parsed options, and
               which option the AI recommends by default.

run_phase2() -> Agents 4, 5, using ONLY the confirmed option. Agent 4 and
               Agent 5 prompts are unchanged - the confirmed choice is
               simply stated at the top of the solution_components text
               they already expect, so they never need to know HITL exists.

run_pipeline() -> kept for backwards compatibility. Runs phase1 then
                 auto-accepts the AI-recommended option and runs phase2.
"""

from .agents import (
    agent1_interpreter,
    agent2_analysis,
    agent3_solution,
    agent4_architecture,
    agent5_proposal,
)


def run_phase1(process_description: str, current_challenges: str = "", system_constraints: str = "", progress_callback=None) -> dict:
    """
    progress_callback: optional function(step_name: str, state: str) called
    as "running" right before each agent starts and "done" right after it
    finishes, so a caller (e.g. Streamlit) can show live progress.
    """
    def notify(step, state):
        if progress_callback:
            progress_callback(step, state)

    notify("Process Interpreter", "running")
    process_breakdown = agent1_interpreter.run(
        process_description=process_description,
        current_challenges=current_challenges,
        system_constraints=system_constraints,
    )
    notify("Process Interpreter", "done")

    notify("Analysis Agent", "running")
    gap_analysis = agent2_analysis.run(structured_process=process_breakdown)
    notify("Analysis Agent", "done")

    notify("Solution Designer", "running")
    raw_solution_output = agent3_solution.run(
        structured_process=process_breakdown,
        gap_analysis=gap_analysis,
    )
    solution_design, options, recommended_key = agent3_solution.parse_options(raw_solution_output)
    notify("Solution Designer", "done")

    return {
        "process_breakdown": process_breakdown,
        "gap_analysis": gap_analysis,
        "solution_design": solution_design,
        "options": options,
        "recommended_key": recommended_key,
    }


def run_phase2(phase1_results: dict, selected_key: str, progress_callback=None) -> dict:
    """
    Runs Agents 4-5 using only the option the consultant confirmed.

    progress_callback: optional function(step_name: str, state: str), same
    contract as in run_phase1().

    When the consultant accepts the AI's default pick (the
    common case), nothing extra runs.
    """
    def notify(step, state):
        if progress_callback:
            progress_callback(step, state)

    process_breakdown = phase1_results["process_breakdown"]
    gap_analysis = phase1_results["gap_analysis"]
    solution_design = phase1_results["solution_design"]
    options = phase1_results["options"]
    recommended_key = phase1_results["recommended_key"]

    selected_name = options[selected_key]["name"]

    if selected_key != recommended_key:
        notify("Updating Solution Detail (your selection)", "running")
        # Consultant overrode the AI's pick - regenerate the winning-approach
        detail_text = agent3_solution.generate_option_details(
            structured_process=process_breakdown,
            gap_analysis=gap_analysis,
            option_name=selected_name,
            option_summary=options[selected_key].get("summary", selected_name),
        )
        # Keep the shared part (options evaluated + comparison matrix - still valid regardless of which option won), drop the old
        # AI-pick-specific detail, and append the freshly generated detail for the confirmed option.
        shared_part = solution_design.split(agent3_solution.RECOMMENDED_SECTION_MARKER)[0].rstrip()
        solution_design = f"{shared_part}\n\n{detail_text}"
        notify("Updating Solution Detail (your selection)", "done")

    solution_components_for_downstream = (
        f"CONFIRMED SELECTION (chosen by the consultant - the component/\n"
        f"integration/architecture detail below already corresponds to\n"
        f"this approach; use it as-is): {selected_name}\n\n"
        f"{solution_design}"
    )

    notify("Architecture Agent", "running")
    raw_architecture = agent4_architecture.run(
        structured_process=process_breakdown,
        solution_components=solution_components_for_downstream,
        gap_analysis=gap_analysis,
    )
    architecture, architecture_diagram_spec = agent4_architecture.parse_architecture(raw_architecture)
    notify("Architecture Agent", "done")

    notify("Proposal Generator", "running")
    final_proposal = agent5_proposal.run(
        process_breakdown,
        gap_analysis,
        solution_components_for_downstream,
        architecture,
    )
    notify("Proposal Generator", "done")

    return {
        **phase1_results,
        "solution_design": solution_design,  # overwritten
        "selected_key": selected_key,
        "selected_option_name": selected_name,
        "architecture": architecture,
        "architecture_diagram_spec": architecture_diagram_spec,
        "final_proposal": final_proposal,
    }


def run_pipeline(process_description: str, current_challenges: str = "", system_constraints: str = "") -> dict:
    """
    Full end-to-end run with no human pause - auto-accepts the AI's
    recommended option. Useful for test.py / a future CLI / batch runs.
    """
    phase1_results = run_phase1(process_description, current_challenges, system_constraints)
    return run_phase2(phase1_results, phase1_results["recommended_key"])