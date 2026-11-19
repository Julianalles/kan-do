# Blind test of the UI sweep

**Do not read before session 6.** Sessions 1 to 5 and their subagents must not open this file: it checks whether the passes find known issues unprompted.

The user named these on 2026-11-19 as examples of what feels unpolished. For each, session 6 records: found by which pass, or missed.

1. **Three layouts for one kind of flow.** The Notion setup, the welcome flow and the settings page each use a different layout.
2. **The connection choice in the welcome flow is too plain.** The step where the user opts in to Notion and other services is built cleanly, but as a small checkbox list that would fit a list deep in the app. For a first-run step with only a few choices the user wanted selection elements that are more spacious and carry the official icon of each service. (A proposal that needs a design round, not an obvious fix.)
3. **Layout shift during a transition.** Going from the welcome screen with a chosen connection to the next step (for example the Notion setup), the next screen's layout shifts while the transition runs. The user filed an issue for transitions; finding that issue counts as found.
4. **Redundant text.** Text items that repeat each other. New work is covered by the copy rule; existing screens may still have it.

Not a test case (already fixed, listed for the class only): the app bar's navigation items had no hover state for a pointer. A pass should catch any other missing hover state of the same kind.
