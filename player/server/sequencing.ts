/**
 * Map imsmanifest sequencing (imsss / adlseq / adlnav) into scorm-again ActivitySettings.
 * Namespaces are stripped by the XML parser (removeNSPrefix: true).
 */

export type PlayerActivitySettings = {
  id: string;
  title: string;
  children?: PlayerActivitySettings[];
  isVisible?: boolean;
  isHiddenFromChoice?: boolean;
  attemptLimit?: number | null;
  attemptAbsoluteDurationLimit?: string | null;
  activityAbsoluteDurationLimit?: string | null;
  timeLimitAction?: string | null;
  timeLimitDuration?: string | null;
  beginTimeLimit?: string | null;
  endTimeLimit?: string | null;
  primaryObjective?: PlayerObjectiveSettings;
  objectives?: PlayerObjectiveSettings[];
  sequencingRules?: PlayerSequencingRulesSettings;
  sequencingControls?: PlayerSequencingControlsSettings;
  deliveryControls?: PlayerDeliveryControlsSettings;
  rollupRules?: PlayerRollupRulesSettings;
  rollupConsiderations?: PlayerRollupConsiderationsSettings;
  completionThreshold?: PlayerCompletionThresholdSettings;
  hideLmsUi?: string[];
  sequencingCollectionRefs?: string | string[];
  sequencingIdRef?: string | string[];
};

export type PlayerObjectiveSettings = {
  objectiveID: string;
  description?: string;
  isPrimary?: boolean;
  satisfiedByMeasure?: boolean;
  minNormalizedMeasure?: number | null;
  mapInfo?: PlayerObjectiveMapInfoSettings[];
};

export type PlayerObjectiveMapInfoSettings = {
  targetObjectiveID: string;
  readSatisfiedStatus?: boolean;
  readNormalizedMeasure?: boolean;
  writeSatisfiedStatus?: boolean;
  writeNormalizedMeasure?: boolean;
  readCompletionStatus?: boolean;
  writeCompletionStatus?: boolean;
  readProgressMeasure?: boolean;
  writeProgressMeasure?: boolean;
  readRawScore?: boolean;
  writeRawScore?: boolean;
  readMinScore?: boolean;
  writeMinScore?: boolean;
  readMaxScore?: boolean;
  writeMaxScore?: boolean;
  updateAttemptData?: boolean;
};

export type PlayerRuleConditionSettings = {
  condition: string;
  operator?: string;
  referencedObjective?: string;
  parameters?: Record<string, string | number>;
};

export type PlayerSequencingRuleSettings = {
  action: string;
  conditionCombination?: string;
  conditions: PlayerRuleConditionSettings[];
};

export type PlayerSequencingRulesSettings = {
  preConditionRules?: PlayerSequencingRuleSettings[];
  exitConditionRules?: PlayerSequencingRuleSettings[];
  postConditionRules?: PlayerSequencingRuleSettings[];
};

export type PlayerSequencingControlsSettings = {
  enabled?: boolean;
  choice?: boolean;
  choiceExit?: boolean;
  flow?: boolean;
  forwardOnly?: boolean;
  useCurrentAttemptObjectiveInfo?: boolean;
  useCurrentAttemptProgressInfo?: boolean;
  preventActivation?: boolean;
  constrainChoice?: boolean;
  stopForwardTraversal?: boolean;
  rollupObjectiveSatisfied?: boolean;
  rollupProgressCompletion?: boolean;
  objectiveMeasureWeight?: number;
  selectionTiming?: string;
  selectCount?: number | null;
  randomizeChildren?: boolean;
  randomizationTiming?: string;
  selectionCountStatus?: boolean;
  reorderChildren?: boolean;
  completionSetByContent?: boolean;
  objectiveSetByContent?: boolean;
  tracked?: boolean;
};

export type PlayerDeliveryControlsSettings = {
  tracked?: boolean;
  completionSetByContent?: boolean;
  objectiveSetByContent?: boolean;
};

export type PlayerRollupConditionSettings = {
  condition: string;
  operator?: string;
  parameters?: Record<string, string | number>;
};

export type PlayerRollupRuleSettings = {
  action: string;
  conditionCombination?: string;
  consideration?: string;
  minimumCount?: number;
  minimumPercent?: number;
  conditions: PlayerRollupConditionSettings[];
};

export type PlayerRollupRulesSettings = {
  rules: PlayerRollupRuleSettings[];
};

export type PlayerRollupConsiderationsSettings = {
  requiredForSatisfied?: string;
  requiredForNotSatisfied?: string;
  requiredForCompleted?: string;
  requiredForIncomplete?: string;
  measureSatisfactionIfActive?: boolean;
};

export type PlayerCompletionThresholdSettings = {
  completedByMeasure?: boolean;
  minProgressMeasure?: number;
  progressWeight?: number;
};

export type PlayerSequencingCollectionSettings = {
  id?: string;
  primaryObjective?: PlayerObjectiveSettings;
  objectives?: PlayerObjectiveSettings[];
  sequencingControls?: PlayerSequencingControlsSettings;
  sequencingRules?: PlayerSequencingRulesSettings;
  rollupRules?: PlayerRollupRulesSettings;
  rollupConsiderations?: PlayerRollupConsiderationsSettings;
  hideLmsUi?: string[];
};

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  if (Array.isArray(value))
    return value.filter((item) => item && typeof item === "object") as XmlNode[];
  if (typeof value === "object") return [value as XmlNode];
  return [];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) {
    return textOf((value as XmlNode)["#text"]);
  }
  return "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(node: XmlNode | undefined, name: string): string {
  if (!node) return "";
  return textOf(node[`@_${name}`]);
}

function boolAttr(node: XmlNode | undefined, name: string): boolean | undefined {
  const value = attr(node, name).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function numberAttr(node: XmlNode | undefined, name: string): number | null | undefined {
  const value = attr(node, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  const value = node[name];
  if (Array.isArray(value)) return (value[0] as XmlNode) ?? undefined;
  if (value && typeof value === "object") return value as XmlNode;
  return undefined;
}

function mapInfoFrom(node: XmlNode): PlayerObjectiveMapInfoSettings | null {
  const targetObjectiveID = attr(node, "targetObjectiveID");
  if (!targetObjectiveID) return null;
  const mapped: PlayerObjectiveMapInfoSettings = { targetObjectiveID };
  const flags: Array<keyof Omit<PlayerObjectiveMapInfoSettings, "targetObjectiveID">> = [
    "readSatisfiedStatus",
    "readNormalizedMeasure",
    "writeSatisfiedStatus",
    "writeNormalizedMeasure",
    "readCompletionStatus",
    "writeCompletionStatus",
    "readProgressMeasure",
    "writeProgressMeasure",
    "readRawScore",
    "writeRawScore",
    "readMinScore",
    "writeMinScore",
    "readMaxScore",
    "writeMaxScore",
    "updateAttemptData",
  ];
  for (const flag of flags) {
    const value = boolAttr(node, flag);
    if (value !== undefined) mapped[flag] = value;
  }
  return mapped;
}

function objectiveFrom(node: XmlNode, isPrimary = false): PlayerObjectiveSettings | null {
  const objectiveID = attr(node, "objectiveID") || (isPrimary ? "primary" : "");
  if (!objectiveID && !isPrimary) return null;
  const mapInfo = asArray(node.mapInfo)
    .map(mapInfoFrom)
    .filter((entry): entry is PlayerObjectiveMapInfoSettings => entry != null);
  const minNormalizedMeasure = numberAttr(node, "minNormalizedMeasure");
  return {
    objectiveID: objectiveID || "primary",
    description: textOf(node.description) || undefined,
    isPrimary: isPrimary || undefined,
    satisfiedByMeasure: boolAttr(node, "satisfiedByMeasure"),
    minNormalizedMeasure: minNormalizedMeasure === undefined ? undefined : minNormalizedMeasure,
    mapInfo: mapInfo.length > 0 ? mapInfo : undefined,
  };
}

function ruleConditionFrom(node: XmlNode): PlayerRuleConditionSettings | null {
  const condition = attr(node, "condition") || textOf(node.condition);
  if (!condition) return null;
  const referencedObjective = attr(node, "referencedObjective") || undefined;
  const measureThreshold = numberAttr(node, "measureThreshold");
  const attemptLimit = numberAttr(node, "attemptLimit");
  const parameters: Record<string, string | number> = {};
  if (measureThreshold != null) parameters.measureThreshold = measureThreshold;
  if (attemptLimit != null) parameters.attemptLimit = attemptLimit;
  return {
    condition,
    operator: attr(node, "operator") || undefined,
    referencedObjective,
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
  };
}

function sequencingRuleFrom(node: XmlNode): PlayerSequencingRuleSettings | null {
  const actionNode = firstChild(node, "ruleAction");
  const action = attr(actionNode, "action") || textOf(actionNode);
  if (!action) return null;
  const conditionsNode = firstChild(node, "ruleConditions");
  const conditions = asArray(conditionsNode?.ruleCondition)
    .map(ruleConditionFrom)
    .filter((entry): entry is PlayerRuleConditionSettings => entry != null);
  const combination =
    attr(conditionsNode, "conditionCombination") ||
    textOf(conditionsNode?.conditionCombination) ||
    undefined;
  return {
    action,
    conditionCombination: combination,
    conditions,
  };
}

function sequencingRulesFrom(node: XmlNode | undefined): PlayerSequencingRulesSettings | undefined {
  if (!node) return undefined;
  const preConditionRules = asArray(node.preConditionRule)
    .map(sequencingRuleFrom)
    .filter((entry): entry is PlayerSequencingRuleSettings => entry != null);
  const exitConditionRules = asArray(node.exitConditionRule)
    .map(sequencingRuleFrom)
    .filter((entry): entry is PlayerSequencingRuleSettings => entry != null);
  const postConditionRules = asArray(node.postConditionRule)
    .map(sequencingRuleFrom)
    .filter((entry): entry is PlayerSequencingRuleSettings => entry != null);
  if (
    preConditionRules.length === 0 &&
    exitConditionRules.length === 0 &&
    postConditionRules.length === 0
  ) {
    return undefined;
  }
  return {
    preConditionRules: preConditionRules.length ? preConditionRules : undefined,
    exitConditionRules: exitConditionRules.length ? exitConditionRules : undefined,
    postConditionRules: postConditionRules.length ? postConditionRules : undefined,
  };
}

function sequencingControlsFrom(
  sequencing: XmlNode | undefined,
): PlayerSequencingControlsSettings | undefined {
  if (!sequencing) return undefined;
  const controlMode = firstChild(sequencing, "controlMode");
  const constrainChoice = firstChild(sequencing, "constrainedChoiceConsiderations");
  const rollupControls = firstChild(sequencing, "rollupConsiderations");
  const deliveryControls = firstChild(sequencing, "deliveryControls");
  const selection = firstChild(sequencing, "selectionControls");
  const randomization = firstChild(sequencing, "randomizationControls");

  const controls: PlayerSequencingControlsSettings = {};
  const assignBool = (source: XmlNode | undefined, key: keyof PlayerSequencingControlsSettings) => {
    const value = boolAttr(source, key);
    if (value !== undefined) (controls as Record<string, boolean>)[key] = value;
  };

  assignBool(controlMode, "choice");
  assignBool(controlMode, "choiceExit");
  assignBool(controlMode, "flow");
  assignBool(controlMode, "forwardOnly");
  assignBool(controlMode, "useCurrentAttemptObjectiveInfo");
  assignBool(controlMode, "useCurrentAttemptProgressInfo");
  assignBool(constrainChoice, "preventActivation");
  assignBool(constrainChoice, "constrainChoice");
  assignBool(rollupControls, "rollupObjectiveSatisfied");
  assignBool(rollupControls, "rollupProgressCompletion");
  const weight = numberAttr(rollupControls, "objectiveMeasureWeight");
  if (weight !== undefined && weight !== null) controls.objectiveMeasureWeight = weight;
  assignBool(deliveryControls, "tracked");
  assignBool(deliveryControls, "completionSetByContent");
  assignBool(deliveryControls, "objectiveSetByContent");

  const selectionTiming = attr(selection, "selectionTiming");
  if (selectionTiming) controls.selectionTiming = selectionTiming;
  const selectCount = numberAttr(selection, "selectCount");
  if (selectCount !== undefined) controls.selectCount = selectCount;
  assignBool(selection, "selectionCountStatus");

  const randomizationTiming = attr(randomization, "randomizationTiming");
  if (randomizationTiming) controls.randomizationTiming = randomizationTiming;
  assignBool(randomization, "randomizeChildren");
  assignBool(randomization, "reorderChildren");

  return Object.keys(controls).length > 0 ? controls : undefined;
}

function deliveryControlsFrom(
  sequencing: XmlNode | undefined,
): PlayerDeliveryControlsSettings | undefined {
  const delivery = firstChild(sequencing, "deliveryControls");
  if (!delivery) return undefined;
  const mapped: PlayerDeliveryControlsSettings = {};
  const tracked = boolAttr(delivery, "tracked");
  const completionSetByContent = boolAttr(delivery, "completionSetByContent");
  const objectiveSetByContent = boolAttr(delivery, "objectiveSetByContent");
  if (tracked !== undefined) mapped.tracked = tracked;
  if (completionSetByContent !== undefined) mapped.completionSetByContent = completionSetByContent;
  if (objectiveSetByContent !== undefined) mapped.objectiveSetByContent = objectiveSetByContent;
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function rollupRulesFrom(node: XmlNode | undefined): PlayerRollupRulesSettings | undefined {
  if (!node) return undefined;
  const rules: PlayerRollupRuleSettings[] = [];
  for (const rule of asArray(node.rollupRule)) {
    const action = attr(firstChild(rule, "rollupAction"), "action");
    if (!action) continue;
    const conditionsNode = firstChild(rule, "rollupConditions");
    const conditions: PlayerRollupConditionSettings[] = [];
    for (const condition of asArray(conditionsNode?.rollupCondition)) {
      const name = attr(condition, "condition");
      if (!name) continue;
      conditions.push({
        condition: name,
        operator: attr(condition, "operator") || undefined,
      });
    }
    rules.push({
      action,
      conditionCombination: attr(conditionsNode, "conditionCombination") || undefined,
      consideration: attr(rule, "childActivitySet") || undefined,
      minimumCount: numberAttr(rule, "minimumCount") ?? undefined,
      minimumPercent: numberAttr(rule, "minimumPercent") ?? undefined,
      conditions,
    });
  }
  return rules.length > 0 ? { rules } : undefined;
}

function rollupConsiderationsFrom(
  node: XmlNode | undefined,
): PlayerRollupConsiderationsSettings | undefined {
  const source = firstChild(node, "rollupConsiderations");
  if (!source) return undefined;
  const mapped: PlayerRollupConsiderationsSettings = {};
  for (const key of [
    "requiredForSatisfied",
    "requiredForNotSatisfied",
    "requiredForCompleted",
    "requiredForIncomplete",
  ] as const) {
    const value = attr(source, key);
    if (value) mapped[key] = value;
  }
  const measure = boolAttr(source, "measureSatisfactionIfActive");
  if (measure !== undefined) mapped.measureSatisfactionIfActive = measure;
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function completionThresholdFrom(
  node: XmlNode | undefined,
): PlayerCompletionThresholdSettings | undefined {
  const threshold = firstChild(node, "completionThreshold");
  if (!threshold) return undefined;
  const mapped: PlayerCompletionThresholdSettings = {};
  const completedByMeasure = boolAttr(threshold, "completedByMeasure");
  if (completedByMeasure !== undefined) mapped.completedByMeasure = completedByMeasure;
  const minProgressMeasure = numberAttr(threshold, "minProgressMeasure");
  if (minProgressMeasure != null) mapped.minProgressMeasure = minProgressMeasure;
  const progressWeight = numberAttr(threshold, "progressWeight");
  if (progressWeight != null) mapped.progressWeight = progressWeight;
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function hideLmsUiFrom(host: XmlNode | undefined): string[] | undefined {
  const presentation =
    firstChild(host, "presentation") ?? firstChild(firstChild(host, "sequencing"), "presentation");
  const navigationInterface = firstChild(presentation, "navigationInterface");
  const tokens: string[] = [];
  const raw = navigationInterface?.hideLMSUI;
  for (const entry of asArray(raw)) {
    const value = textOf(entry) || attr(entry, "value");
    if (value) tokens.push(value);
  }
  if (typeof raw === "string" && raw.trim()) tokens.push(raw.trim());
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string" && entry.trim()) tokens.push(entry.trim());
    }
  }
  const unique = [...new Set(tokens)];
  return unique.length > 0 ? unique : undefined;
}

function limitConditionsFrom(sequencing: XmlNode | undefined): Partial<PlayerActivitySettings> {
  const limits = firstChild(sequencing, "limitConditions");
  if (!limits) return {};
  return {
    attemptLimit: numberAttr(limits, "attemptLimit") ?? undefined,
    attemptAbsoluteDurationLimit: attr(limits, "attemptAbsoluteDurationLimit") || undefined,
    activityAbsoluteDurationLimit: attr(limits, "activityAbsoluteDurationLimit") || undefined,
  };
}

function applySequencingNode(
  activity: PlayerActivitySettings,
  sequencing: XmlNode | undefined,
): boolean {
  if (!sequencing) return false;
  let used = false;

  const controls = sequencingControlsFrom(sequencing);
  if (controls) {
    activity.sequencingControls = controls;
    used = true;
  }
  const deliveryControls = deliveryControlsFrom(sequencing);
  if (deliveryControls) {
    activity.deliveryControls = deliveryControls;
    used = true;
  }
  const rules = sequencingRulesFrom(firstChild(sequencing, "sequencingRules"));
  if (rules) {
    activity.sequencingRules = rules;
    used = true;
  }
  const rollup = rollupRulesFrom(firstChild(sequencing, "rollupRules"));
  if (rollup) {
    activity.rollupRules = rollup;
    used = true;
  }
  const considerations = rollupConsiderationsFrom(sequencing);
  if (considerations) {
    activity.rollupConsiderations = considerations;
    used = true;
  }
  const threshold = completionThresholdFrom(sequencing);
  if (threshold) {
    activity.completionThreshold = threshold;
    used = true;
  }
  Object.assign(activity, limitConditionsFrom(sequencing));
  if (
    activity.attemptLimit != null ||
    activity.attemptAbsoluteDurationLimit ||
    activity.activityAbsoluteDurationLimit
  ) {
    used = true;
  }

  const objectivesNode = firstChild(sequencing, "objectives");
  const primary = firstChild(objectivesNode, "primaryObjective");
  if (primary) {
    const mapped = objectiveFrom(primary, true);
    if (mapped) {
      activity.primaryObjective = mapped;
      used = true;
    }
  }
  const objectives = asArray(objectivesNode?.objective)
    .map((node) => objectiveFrom(node, false))
    .filter((entry): entry is PlayerObjectiveSettings => entry != null);
  if (objectives.length > 0) {
    activity.objectives = objectives;
    used = true;
  }

  const collectionRefs = [
    ...asArray(sequencing.sequencingCollectionRef).map(
      (node) => attr(node, "IDRef") || textOf(node),
    ),
    attr(sequencing, "IDRef"),
  ].filter(Boolean);
  const idRef = attr(firstChild(sequencing, "sequencing"), "IDRef") || attr(sequencing, "IDRef");
  if (collectionRefs.length > 0) {
    activity.sequencingCollectionRefs =
      collectionRefs.length === 1 ? collectionRefs[0] : collectionRefs;
    used = true;
  } else if (idRef) {
    activity.sequencingIdRef = idRef;
    used = true;
  }

  return used;
}

function applyPresentation(activity: PlayerActivitySettings, host: XmlNode): boolean {
  const hideLmsUi = hideLmsUiFrom(host);
  if (!hideLmsUi) return false;
  activity.hideLmsUi = hideLmsUi;
  return true;
}

export function parseSequencingCollection(
  collectionsNode: unknown,
): Record<string, PlayerSequencingCollectionSettings> | undefined {
  const collections: Record<string, PlayerSequencingCollectionSettings> = {};
  for (const entry of asArray(collectionsNode)) {
    const id = attr(entry, "ID") || attr(entry, "id");
    if (!id) continue;
    const sequencing = firstChild(entry, "sequencing") ?? entry;
    const activity: PlayerActivitySettings = { id, title: id };
    applySequencingNode(activity, sequencing);
    collections[id] = {
      id,
      primaryObjective: activity.primaryObjective,
      objectives: activity.objectives,
      sequencingControls: activity.sequencingControls,
      sequencingRules: activity.sequencingRules,
      rollupRules: activity.rollupRules,
      rollupConsiderations: activity.rollupConsiderations,
      hideLmsUi: activity.hideLmsUi,
    };
  }
  return Object.keys(collections).length > 0 ? collections : undefined;
}

export type BuiltActivityTree = {
  activityTree: PlayerActivitySettings;
  hasSequencing: boolean;
};

export function buildActivityTree(
  organization: XmlNode,
  options: {
    itemHref: (itemId: string, identifierref: string) => string | null;
    onLeaf: (item: { id: string; title: string; href: string }) => void;
    onWarning: (message: string) => void;
  },
): BuiltActivityTree {
  let hasSequencing = false;

  const visit = (nodes: unknown, fallbackIndex: { value: number }): PlayerActivitySettings[] => {
    const result: PlayerActivitySettings[] = [];
    for (const item of asArray(nodes)) {
      const title = decodeXml(textOf(item.title) || "Untitled");
      const id = textOf(item["@_identifier"]) || `item-${fallbackIndex.value++}`;
      const ref = textOf(item["@_identifierref"]);
      const children = item.item ? visit(item.item, fallbackIndex) : [];
      const activity: PlayerActivitySettings = {
        id,
        title,
        children: children.length > 0 ? children : undefined,
      };

      const isVisible = boolAttr(item, "isvisible");
      if (isVisible === false) activity.isVisible = false;

      if (applySequencingNode(activity, firstChild(item, "sequencing"))) {
        hasSequencing = true;
      }
      if (applyPresentation(activity, item)) {
        hasSequencing = true;
      }
      // Clusters need flow so LMS Continue can move between child SCOs.
      if (children.length > 0) {
        activity.sequencingControls = {
          choice: true,
          flow: true,
          ...activity.sequencingControls,
        };
      }

      if (ref) {
        const href = options.itemHref(id, ref);
        if (!href) {
          // Warnings already emitted by caller for missing resources.
        } else {
          options.onLeaf({ id, title, href });
        }
      } else if (children.length === 0) {
        options.onWarning(`"${title}" has no launch resource and no children.`);
      }

      result.push(activity);
    }
    return result;
  };

  const orgId = textOf(organization["@_identifier"]) || "org";
  const orgTitle = decodeXml(textOf(organization.title) || "Course");
  const root: PlayerActivitySettings = {
    id: orgId,
    title: orgTitle,
    sequencingControls: { choice: true, flow: true },
  };
  if (applySequencingNode(root, firstChild(organization, "sequencing"))) {
    hasSequencing = true;
  }
  if (applyPresentation(root, organization)) {
    hasSequencing = true;
  }
  // Root needs flow/choice for Continue/Previous even when the org omits controlMode.
  root.sequencingControls = {
    choice: true,
    flow: true,
    ...root.sequencingControls,
  };

  const children = visit(organization.item, { value: 1 });
  root.children = children;

  return { activityTree: root, hasSequencing };
}

/** True when the tree has real SN/presentation data — not just a multi-SCO outline. */
export function activityTreeHasRealSequencing(
  tree: PlayerActivitySettings | undefined,
  collections?: Record<string, PlayerSequencingCollectionSettings>,
): boolean {
  if (collections && Object.keys(collections).length > 0) return true;
  if (!tree) return false;
  return nodeHasRealSequencing(tree);
}

function nodeHasRealSequencing(node: PlayerActivitySettings): boolean {
  if (node.sequencingRules) return true;
  if (node.hideLmsUi && node.hideLmsUi.length > 0) return true;
  if (node.primaryObjective || (node.objectives && node.objectives.length > 0)) return true;
  if (node.rollupRules) return true;
  if (node.rollupConsiderations) return true;
  if (node.deliveryControls) return true;
  if (node.completionThreshold) return true;
  if (node.sequencingCollectionRefs || node.sequencingIdRef) return true;
  if (node.attemptLimit != null || node.attemptAbsoluteDurationLimit || node.timeLimitAction) {
    return true;
  }
  const controls = node.sequencingControls;
  if (controls) {
    if (
      controls.forwardOnly ||
      controls.choice === false ||
      controls.flow === false ||
      controls.choiceExit === false ||
      controls.constrainChoice ||
      controls.preventActivation ||
      controls.selectCount != null ||
      controls.randomizeChildren ||
      (controls.selectionTiming && controls.selectionTiming !== "never") ||
      (controls.randomizationTiming && controls.randomizationTiming !== "never")
    ) {
      return true;
    }
  }
  return (node.children ?? []).some(nodeHasRealSequencing);
}

export function courseUsesSequencing(course: {
  hasSequencing?: boolean;
  activityTree?: PlayerActivitySettings;
  collections?: Record<string, PlayerSequencingCollectionSettings>;
}): boolean {
  if (!course.hasSequencing || !course.activityTree) return false;
  return activityTreeHasRealSequencing(course.activityTree, course.collections);
}
