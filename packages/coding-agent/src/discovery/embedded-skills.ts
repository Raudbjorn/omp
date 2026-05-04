import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import configGuideMd from "../../skills/config-guide/SKILL.md" with { type: "text" };
import type { Skill, SkillFrontmatter } from "../capability/skill";

const EMBEDDED_SKILL_SOURCES: { name: string; content: string }[] = [{ name: "config-guide", content: configGuideMd }];

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
