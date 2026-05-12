import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import configGuideMd from "../../skills/config-guide/SKILL.md" with { type: "text" };
import brainstormingMd from "../../skills/superpowers/brainstorming/SKILL.md" with { type: "text" };
import brainstorming_scripts_frame_template_md from "../../skills/superpowers/brainstorming/scripts/frame-template.md" with {
	type: "text",
};
import brainstorming_scripts_helper_md from "../../skills/superpowers/brainstorming/scripts/helper.md" with {
	type: "text",
};
import brainstorming_scripts_server_md from "../../skills/superpowers/brainstorming/scripts/server.md" with {
	type: "text",
};
import brainstorming_scripts_start_server_md from "../../skills/superpowers/brainstorming/scripts/start-server.md" with {
	type: "text",
};
import brainstorming_scripts_stop_server_md from "../../skills/superpowers/brainstorming/scripts/stop-server.md" with {
	type: "text",
};
import brainstorming_spec_document_reviewer_prompt_md from "../../skills/superpowers/brainstorming/spec-document-reviewer-prompt.md" with {
	type: "text",
};
import brainstorming_visual_companion_md from "../../skills/superpowers/brainstorming/visual-companion.md" with {
	type: "text",
};
import dispatching_parallel_agentsMd from "../../skills/superpowers/dispatching-parallel-agents/SKILL.md" with {
	type: "text",
};
import executing_plansMd from "../../skills/superpowers/executing-plans/SKILL.md" with { type: "text" };
import finishing_a_development_branchMd from "../../skills/superpowers/finishing-a-development-branch/SKILL.md" with {
	type: "text",
};
import receiving_code_reviewMd from "../../skills/superpowers/receiving-code-review/SKILL.md" with { type: "text" };
import requesting_code_review_code_reviewer_md from "../../skills/superpowers/requesting-code-review/code-reviewer.md" with {
	type: "text",
};
import requesting_code_reviewMd from "../../skills/superpowers/requesting-code-review/SKILL.md" with { type: "text" };
import subagent_driven_development_code_quality_reviewer_prompt_md from "../../skills/superpowers/subagent-driven-development/code-quality-reviewer-prompt.md" with {
	type: "text",
};
import subagent_driven_development_implementer_prompt_md from "../../skills/superpowers/subagent-driven-development/implementer-prompt.md" with {
	type: "text",
};
import subagent_driven_developmentMd from "../../skills/superpowers/subagent-driven-development/SKILL.md" with {
	type: "text",
};
import subagent_driven_development_spec_reviewer_prompt_md from "../../skills/superpowers/subagent-driven-development/spec-reviewer-prompt.md" with {
	type: "text",
};
import systematic_debugging_CREATION_LOG_md from "../../skills/superpowers/systematic-debugging/CREATION-LOG.md" with {
	type: "text",
};
import systematic_debugging_condition_based_waiting_md from "../../skills/superpowers/systematic-debugging/condition-based-waiting.md" with {
	type: "text",
};
import systematic_debugging_condition_based_waiting_example_md from "../../skills/superpowers/systematic-debugging/condition-based-waiting-example.md" with {
	type: "text",
};
import systematic_debugging_defense_in_depth_md from "../../skills/superpowers/systematic-debugging/defense-in-depth.md" with {
	type: "text",
};
import systematic_debugging_find_polluter_md from "../../skills/superpowers/systematic-debugging/find-polluter.md" with {
	type: "text",
};
import systematic_debugging_root_cause_tracing_md from "../../skills/superpowers/systematic-debugging/root-cause-tracing.md" with {
	type: "text",
};
import systematic_debuggingMd from "../../skills/superpowers/systematic-debugging/SKILL.md" with { type: "text" };
import systematic_debugging_test_academic_md from "../../skills/superpowers/systematic-debugging/test-academic.md" with {
	type: "text",
};
import systematic_debugging_test_pressure_1_md from "../../skills/superpowers/systematic-debugging/test-pressure-1.md" with {
	type: "text",
};
import systematic_debugging_test_pressure_2_md from "../../skills/superpowers/systematic-debugging/test-pressure-2.md" with {
	type: "text",
};
import systematic_debugging_test_pressure_3_md from "../../skills/superpowers/systematic-debugging/test-pressure-3.md" with {
	type: "text",
};
import test_driven_developmentMd from "../../skills/superpowers/test-driven-development/SKILL.md" with { type: "text" };
import test_driven_development_testing_anti_patterns_md from "../../skills/superpowers/test-driven-development/testing-anti-patterns.md" with {
	type: "text",
};
import using_git_worktreesMd from "../../skills/superpowers/using-git-worktrees/SKILL.md" with { type: "text" };
import using_superpowersMd from "../../skills/superpowers/using-superpowers/SKILL.md" with { type: "text" };
import verification_before_completionMd from "../../skills/superpowers/verification-before-completion/SKILL.md" with {
	type: "text",
};
import writing_plans_plan_document_reviewer_prompt_md from "../../skills/superpowers/writing-plans/plan-document-reviewer-prompt.md" with {
	type: "text",
};
import writing_plansMd from "../../skills/superpowers/writing-plans/SKILL.md" with { type: "text" };
import writing_skills_anthropic_best_practices_md from "../../skills/superpowers/writing-skills/anthropic-best-practices.md" with {
	type: "text",
};
import writing_skills_examples_CLAUDE_MD_TESTING_md from "../../skills/superpowers/writing-skills/examples/CLAUDE_MD_TESTING.md" with {
	type: "text",
};
import writing_skills_graphviz_conventions_md from "../../skills/superpowers/writing-skills/graphviz-conventions.md" with {
	type: "text",
};
import writing_skills_persuasion_principles_md from "../../skills/superpowers/writing-skills/persuasion-principles.md" with {
	type: "text",
};
import writing_skills_render_graphs_md from "../../skills/superpowers/writing-skills/render-graphs.md" with {
	type: "text",
};
import writing_skillsMd from "../../skills/superpowers/writing-skills/SKILL.md" with { type: "text" };
import writing_skills_testing_skills_with_subagents_md from "../../skills/superpowers/writing-skills/testing-skills-with-subagents.md" with {
	type: "text",
};
import type { Skill, SkillFrontmatter } from "../capability/skill";

interface EmbeddedSkillSource {
	name: string;
	content: string;
	files: Map<string, string>;
}

const EMBEDDED_SKILL_SOURCES: EmbeddedSkillSource[] = [
	{ name: "config-guide", content: configGuideMd, files: new Map() },
	{
		name: "brainstorming",
		content: brainstormingMd,
		files: new Map([
			["scripts/frame-template.md", brainstorming_scripts_frame_template_md],
			["scripts/helper.md", brainstorming_scripts_helper_md],
			["scripts/server.md", brainstorming_scripts_server_md],
			["scripts/start-server.md", brainstorming_scripts_start_server_md],
			["scripts/stop-server.md", brainstorming_scripts_stop_server_md],
			["spec-document-reviewer-prompt.md", brainstorming_spec_document_reviewer_prompt_md],
			["visual-companion.md", brainstorming_visual_companion_md],
		]),
	},
	{ name: "dispatching-parallel-agents", content: dispatching_parallel_agentsMd, files: new Map([]) },
	{ name: "executing-plans", content: executing_plansMd, files: new Map([]) },
	{ name: "finishing-a-development-branch", content: finishing_a_development_branchMd, files: new Map([]) },
	{ name: "receiving-code-review", content: receiving_code_reviewMd, files: new Map([]) },
	{
		name: "requesting-code-review",
		content: requesting_code_reviewMd,
		files: new Map([["code-reviewer.md", requesting_code_review_code_reviewer_md]]),
	},
	{
		name: "subagent-driven-development",
		content: subagent_driven_developmentMd,
		files: new Map([
			["code-quality-reviewer-prompt.md", subagent_driven_development_code_quality_reviewer_prompt_md],
			["implementer-prompt.md", subagent_driven_development_implementer_prompt_md],
			["spec-reviewer-prompt.md", subagent_driven_development_spec_reviewer_prompt_md],
		]),
	},
	{
		name: "systematic-debugging",
		content: systematic_debuggingMd,
		files: new Map([
			["CREATION-LOG.md", systematic_debugging_CREATION_LOG_md],
			["condition-based-waiting-example.md", systematic_debugging_condition_based_waiting_example_md],
			["condition-based-waiting.md", systematic_debugging_condition_based_waiting_md],
			["defense-in-depth.md", systematic_debugging_defense_in_depth_md],
			["find-polluter.md", systematic_debugging_find_polluter_md],
			["root-cause-tracing.md", systematic_debugging_root_cause_tracing_md],
			["test-academic.md", systematic_debugging_test_academic_md],
			["test-pressure-1.md", systematic_debugging_test_pressure_1_md],
			["test-pressure-2.md", systematic_debugging_test_pressure_2_md],
			["test-pressure-3.md", systematic_debugging_test_pressure_3_md],
		]),
	},
	{
		name: "test-driven-development",
		content: test_driven_developmentMd,
		files: new Map([["testing-anti-patterns.md", test_driven_development_testing_anti_patterns_md]]),
	},
	{ name: "using-git-worktrees", content: using_git_worktreesMd, files: new Map([]) },
	{ name: "using-superpowers", content: using_superpowersMd, files: new Map([]) },
	{ name: "verification-before-completion", content: verification_before_completionMd, files: new Map([]) },
	{
		name: "writing-plans",
		content: writing_plansMd,
		files: new Map([["plan-document-reviewer-prompt.md", writing_plans_plan_document_reviewer_prompt_md]]),
	},
	{
		name: "writing-skills",
		content: writing_skillsMd,
		files: new Map([
			["anthropic-best-practices.md", writing_skills_anthropic_best_practices_md],
			["examples/CLAUDE_MD_TESTING.md", writing_skills_examples_CLAUDE_MD_TESTING_md],
			["graphviz-conventions.md", writing_skills_graphviz_conventions_md],
			["persuasion-principles.md", writing_skills_persuasion_principles_md],
			["render-graphs.md", writing_skills_render_graphs_md],
			["testing-skills-with-subagents.md", writing_skills_testing_skills_with_subagents_md],
		]),
	},
];

let cache: Skill[] | null = null;

export function loadEmbeddedSkills(): Skill[] {
	if (cache) return cache;
	cache = EMBEDDED_SKILL_SOURCES.map(({ name, content }) => {
		const { frontmatter, body } = parseFrontmatter(content, { source: `embedded:${name}/SKILL.md` });
		const fm = frontmatter as SkillFrontmatter;
		const resolvedName = typeof fm?.name === "string" ? fm.name.trim() || name : name;
		return {
			name: resolvedName,
			path: `embedded:${name}/SKILL.md`,
			content: body,
			frontmatter: fm,
			level: "user" as const,
			_source: {
				provider: "native",
				providerName: "OMP",
				path: `embedded:${name}/SKILL.md`,
				level: "user" as const,
			},
		};
	});
	return cache;
}

export function getEmbeddedSkillContent(skillName: string): string | undefined {
	return EMBEDDED_SKILL_SOURCES.find(s => s.name === skillName)?.content;
}

export function getEmbeddedFileContent(skillName: string, relativePath: string): string | undefined {
	const source = EMBEDDED_SKILL_SOURCES.find(s => s.name === skillName);
	if (!source) return undefined;
	return source.files.get(relativePath);
}
