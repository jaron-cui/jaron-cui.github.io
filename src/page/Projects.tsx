import { PROJECTS } from '../util/constants';
import { ProjectInfo } from '../util/types';
import { formatDateString, getRelatedTech, stringsContain } from '../util/util';
import ProjectEntry from '../component/ProjectEntry';
import SearchableEntries from '../component/SearchableEntries';

export default function Projects({ initialSearch }: { initialSearch?: string }) {
  return (
    <SearchableEntries<ProjectInfo>
      title='Search projects (e.g. "java", "physics")'
      entries={PROJECTS}
      sort={(e1, e2) => (e2.date.localeCompare(e1.date))}
      searchFor={searchFor}
      Entry={ProjectEntry}
      initialSearch={initialSearch}
    />
  );
}

function searchFor(search: string) {
  return function matchProject(project: ProjectInfo) {
    const strings: string[] = [
      formatDateString(project.date),
      project.title,
      ...getRelatedTech(project.technologies),
      ...(project.features || [])
    ];

    return stringsContain(strings, search);
  }
}
