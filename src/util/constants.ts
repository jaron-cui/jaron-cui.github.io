import { ExperienceInfo, ProjectInfo } from "./types";
import projects from '../data/projects.json';
import experiences from '../data/experiences.json';
import { NEW_PROJECTS } from "./projects";

export const LEGACY_PROJECTS: ProjectInfo[] = projects.map(project => ({ legacy: true, ...project })) as ProjectInfo[];
export const PROJECTS: ProjectInfo[] = [...LEGACY_PROJECTS, ...NEW_PROJECTS];

const projectMap: {[key in string]: ProjectInfo} = {};
PROJECTS.forEach(project => projectMap[project.id] = project);

export const PROJECT_MAP = projectMap;

export const EXPERIENCES: ExperienceInfo[] = experiences as ExperienceInfo[];

// Kept in their own modules so pages that need only these don't load every project's page.
export { LINKS } from './links';
export { TECH_DEPENDENCIES, TECH_SYNONYMS } from './tech';
