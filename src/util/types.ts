export type LegacyProjectInfo = {
  legacy: true;
  id: string;
  title: string;
  date: string;
  status: ProjectStatus;
  technologies: string[];
  features: string[];
  paragraphs: string[];
  repository?: string;
  video?: string;
  clip?: string;
  gallery?: Media[];
};

export type NewProjectInfo = {
  legacy: false;
  id: string;
  title: string;
  date: string;
  status: ProjectStatus;
  technologies: string[];
  repository?: string;
  features?: string[];
  page: (fullpage: boolean) => JSX.Element;
};

export type ProjectInfo = LegacyProjectInfo | NewProjectInfo;

export type ProjectStatus = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD';

export type Season = 'Spring' | 'Summer I' | 'Summer II' | 'Fall';

export type Semester = `${Season} ${number}`;

export type Semesters = {
  semesters: Semester[];
}

export type StartAndEnd = {
  start: string;
  end: string;
}

export type Timeframe = Semesters | StartAndEnd;

export type ExperienceInfo = {
  id: string;
  title: string;
  organization: string;
  timeframe: Timeframe;
  paragraphs: string[];
  projects?: string[];
}

export type MediaType = 'image' | 'video';

export type Media = {
  type: MediaType;
  description: string;
  link: string;
}