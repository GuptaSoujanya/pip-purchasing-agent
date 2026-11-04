# Publishing this repository

You are pushing this yourself — nothing here has been pushed anywhere. These are the exact steps.

---

## 1. Repository name

**Recommended:**

```
ai-purchasing-agent
```

It matches the assignment title, matches the project directory, and reads correctly in a URL:
`github.com/<you>/ai-purchasing-agent`.

Reasonable alternatives if that name is taken:

| Name | Note |
|---|---|
| `ai-buyer-agent` | Matches the filename of the brief you were sent |
| `purchasing-agent` | Shorter; slightly less specific |
| `rappi-ai-purchasing-agent` | Only if you want the company name on it — some reviewers prefer you don't |

**Suggested description** (the one-line field on GitHub):

> A full-stack AI agent that makes, executes and validates purchasing decisions — with constraint
> checking, human-in-the-loop approval, and a post-execution feedback loop that self-corrects when
> suppliers under-deliver.

**Suggested topics:** `ai-agent`, `llm`, `typescript`, `nextjs`, `supply-chain`, `procurement`

---

## 2. Before you push — check nothing sensitive is in the tree

```bash
cd ai-purchasing-agent

# Should print nothing:
git ls-files | grep -E '^\.env$|^\.env\.local$|\.db$'

# Should print nothing:
git log --all -p | grep -iE "(api[_-]?key|secret|password|token)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9_-]{16,}"
```

Both were clean at the last check. `.env.example` contains only commented-out placeholder names,
which is what the brief asks for.

---

## 3. Create the repository and push

**With the GitHub CLI** (easiest — creates the repo and pushes in one step):

```bash
cd ai-purchasing-agent
gh repo create ai-purchasing-agent --public --source=. --remote=origin --push
```

**Without the CLI** — create an empty public repo on github.com first (no README, no .gitignore,
no licence; the repo already has them), then:

```bash
cd ai-purchasing-agent
git branch -M main
git remote add origin https://github.com/<your-username>/ai-purchasing-agent.git
git push -u origin main
```

---

## 4. Check it landed correctly

Open the repository and confirm:

- [ ] The README renders, and the **three architecture diagrams display as diagrams** — GitHub
      renders Mermaid natively, so they should be pictures, not code blocks.
- [ ] The screenshots in `DEMO.md` load.
- [ ] The commit history is present and readable — one commit per component, not a single
      "initial commit". The brief says they may review it.
- [ ] `.env.example` is there; `.env` and `.env.local` are not.
- [ ] `node_modules/`, `.next/` and `data/` are absent.

Then submit the URL: `https://github.com/<your-username>/ai-purchasing-agent`

---

## 5. If you need to amend after pushing

The brief says **commits after the deadline won't be considered**, so push everything before it.
If you must fix something afterwards, prefer a normal commit over rewriting history — they asked
for the history to be kept intact.

---

## 6. Before the evaluation discussion

You should be able to explain and modify this. The questions most likely to come up:

**"Why doesn't the LLM make the decision?"**
It proposes; the policy engine and constraint engine dispose. A proposal breaching a hard
constraint is overridden and never executed. One diverging more than 15% from what the data
supports is overridden *and* has its confidence lowered, which routes it to a human. Divergence is
written to the trace either way. The model's upside is judgement and explanation; its downside is
bounded by code that cannot be talked out of a constraint.

**"How do you know the action actually worked?"**
The agent writes an explicit expectation contract before acting, then re-reads the world **from the
database, not from the write tool's return value**. That distinction is the whole feedback loop —
`SUP-03` accepts an order for 1,500 units, reports success, and confirms 400. The only way to find
out is to look.

**"What happens when the correction also fails?"**
Remediation is bounded at two attempts (`agent_policies.max_remediation_attempts`) and prefers a
different supplier — the one that just under-delivered has demonstrated it cannot serve the volume.
Exhausting the attempts escalates with full context rather than retrying indefinitely.

**"How do you know the agent is right and not just confident?"**
Two negative controls in the evaluation suite. Case 2 hands it a recommendation that *is* correct —
it accepts and executes autonomously. Case 5 is a demand spike statistically near-identical to
Scenario 3, but a promotion explains it, so the right answer is to do nothing. Without those, an
agent that always objected and always bought would score 100%.

**"What would you do differently with more time?"**
The honest list is in the README's *Known limitations* section — transactional reservation of
budget and storage, deriving safety stock in the planning path rather than only in the sweep,
and counterfactual promotion attribution instead of a single heuristic.
