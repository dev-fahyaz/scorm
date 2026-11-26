# Track B: SCORM 2004 sequencing objective maps for gated Continue

**Audience:** Track B package creator / manifest exporter  
**Sample:** [`Allcontenttypessample_v1.0.0_2026-11-23.zip`](./Allcontenttypessample_v1.0.0_2026-11-23.zip)  
**Symptom:** LMS Next / SCO `adl.nav.request=continue` never advances; sequencer returns **SB.2.2-2** (next activity disabled).

## Why player-side patching is not the fix

An LMS could rewrite the activity tree at import to inject missing maps. That only helps one player. The same ZIP still fails (or behaves inconsistently) in Moodle, Rustici, and other runtimes that resolve `referencedObjective` against **the activity that owns the rule**, not against a bare global ID.

Fix this in **Track B’s SCORM file creation**.

## What the sample does today (broken)

Each leaf from “02 Link” onward has a precondition like:

```xml
<imsss:sequencingRules>
  <imsss:preConditionRule>
    <imsss:ruleConditions>
      <imsss:ruleCondition
        referencedObjective="obj_item_sample-all-content_1_1"
        operator="not"
        condition="satisfied"/>
    </imsss:ruleConditions>
    <imsss:ruleAction action="disabled"/>
  </imsss:preConditionRule>
</imsss:sequencingRules>
```

The **previous** SCO only defines and **writes** that objective:

```xml
<!-- On SCO 01 Text -->
<imsss:objectives>
  <imsss:primaryObjective objectiveID="obj_item_sample-all-content_1_1">
    <imsss:mapInfo
      targetObjectiveID="obj_item_sample-all-content_1_1"
      writeSatisfiedStatus="true"
      readSatisfiedStatus="true"/>
  </imsss:primaryObjective>
</imsss:objectives>
```

The **gated** SCO (02) does **not** declare `obj_item_sample-all-content_1_1` locally. Its only objective is its own primary (`obj_…_1_2`).

Per SCORM 2004 CAM/SN, `referencedObjective` must identify an objective **associated with the activity being evaluated**. When the ID is missing on that activity, `satisfied` does not become true from the prior SCO’s global write. With `operator="not"`, the activity stays **disabled** forever → Flow **SB.2.2-2** → Continue never delivers the next SCO.

The sample has **zero** non-primary `<imsss:objective>` elements, so every cross-item gate is affected the same way.

## Required authoring pattern

For every “must pass previous before this unlocks” gate:

1. **Writer (previous SCO)** — keep primary objective + `mapInfo` with `writeSatisfiedStatus="true"` (and usually `readSatisfiedStatus="true"`).
2. **Reader (gated SCO)** — add a **secondary** objective whose `objectiveID` matches the ID used in the precondition, with `mapInfo` that **reads** the same global `targetObjectiveID`.
3. Precondition on the gated SCO keeps `referencedObjective` pointing at that **local** secondary objective ID (same string is fine).

### Minimal fix for SCO 02 (after SCO 01 writes `obj_item_sample-all-content_1_1`)

```xml
<item identifier="item_sample-all-content_1_2" identifierref="resource_sample-all-content_1_2">
  <title>02 Link</title>
  <imsss:sequencing>
    <imsss:sequencingRules>
      <imsss:preConditionRule>
        <imsss:ruleConditions>
          <imsss:ruleCondition
            referencedObjective="obj_item_sample-all-content_1_1"
            operator="not"
            condition="satisfied"/>
        </imsss:ruleConditions>
        <imsss:ruleAction action="disabled"/>
      </imsss:preConditionRule>
    </imsss:sequencingRules>
    <imsss:objectives>
      <!-- Unlocks this SCO when previous write lands on the shared global -->
      <imsss:objective objectiveID="obj_item_sample-all-content_1_1">
        <imsss:mapInfo
          targetObjectiveID="obj_item_sample-all-content_1_1"
          readSatisfiedStatus="true"
          writeSatisfiedStatus="false"/>
      </imsss:objective>
      <imsss:primaryObjective objectiveID="obj_item_sample-all-content_1_2">
        <imsss:mapInfo
          targetObjectiveID="obj_item_sample-all-content_1_2"
          writeSatisfiedStatus="true"
          readSatisfiedStatus="true"/>
      </imsss:primaryObjective>
    </imsss:objectives>
  </imsss:sequencing>
</item>
```

Repeat for each gated leaf: N’s precondition references prior objective ID; N declares that ID as a secondary objective with **read** map; N’s primary still writes N’s own objective for the next gate.

## Track B exporter checklist

When emitting ordered / “pass previous” sequencing:

| Step | Action |
|------|--------|
| 1 | Give each leaf a stable primary `objectiveID` (e.g. `obj_<itemId>`). |
| 2 | Primary `mapInfo.targetObjectiveID` = same ID (or a shared global namespace); set `writeSatisfiedStatus="true"`. |
| 3 | For leaf index `i > 0` with a gate on prior leaf `i-1`, emit secondary `<imsss:objective objectiveID="{priorObjectiveId}">` with `readSatisfiedStatus="true"` (do not write unless intentional). |
| 4 | Precondition `referencedObjective` = that **prior** objective ID (now local on leaf `i`). |
| 5 | Do not emit `disabled` + `not satisfied` on an objective ID that does not appear under that item’s `<imsss:objectives>`. |
| 6 | Ensure the SCO sets `cmi.success_status` to `passed` when the learner “passes” (completion alone does not satisfy `condition="satisfied"`). Track B’s `player.js` already does `setSuccess(true)` on content complete — keep that. |

## Cluster / flow controls

Parent clusters need `imsss:controlMode flow="true"` (and usually `choice` as product requires) so LMS Continue can flow between children. If the org omits `controlMode`, many players default flow off; Aspire’s importer currently forces flow on clusters, but other LMSs may not. Prefer emitting explicit `controlMode` on organization and cluster items in Track B.

## How to verify after regenerating the ZIP

1. Upload to any SCORM 2004 sequencer (Aspire player, Moodle, etc.).
2. Open first SCO; complete/pass so `cmi.success_status=passed` is committed.
3. `GetValue("adl.nav.request_valid.continue")` should become `"true"` (or LMS Next enables).
4. Continue delivers the next leaf; outline choice to that leaf is allowed.
5. Without passing SCO 01, Continue stays blocked (**SB.2.2-2**) — that part is intentional.

## Reference

ADL-style shared objective on both writer and gated activity: see scorm-again integration fixture `SequencingRandomTest` (`content_completed` written by content wrapper, read by `posttest_item` via local objective + global `mapInfo`).
