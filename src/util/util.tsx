import { TECH_SYNONYMS, TECH_DEPENDENCIES } from './tech';
import { Timeframe, Semesters, Semester, Season } from './types';

export function wrapContent(content: any) {
  return (
    <div style={{
      width:'100%',
      display:'flex',
      justifyContent: 'center',
      backgroundColor: '#EEEEEE'
    }}>
      {content}
    </div>
  );
}

export function formatDateString(date: string) {
  return dateToString(new Date(`${date}T00:00:00`));
}

export function dateToString(date: Date) {
  return date.toLocaleString('default', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function isSemesterTimeframe(timeframe: Timeframe): timeframe is Semesters {
  return !!((timeframe as Semesters).semesters);
}

export function formatTimeframe(timeframe: Timeframe) {
  return isSemesterTimeframe(timeframe) ?
    timeframe.semesters.join(' | ') :
    `${formatDateString(timeframe.start)} - ${formatDateString(timeframe.end)}`;
}

const SEASON_TO_DATE = {
  'Spring': '01-01',
  'Summer I': '05-09',
  'Summer II': '07-05',
  'Fall': '09-08'
};

export function semesterToDate(semester: Semester) {
  const parts = semester.split(' ');
  let season, year;
  if (parts.length === 2) {
    season = parts[0];
    year = parts[1]
  } else {
    season = `${parts[0]} ${parts[1]}`;
    year = parts[2];
  }
  return `${year}-${SEASON_TO_DATE[season as Season]}`;
}

export function getRelatedStrings(input: string) {
  const related: string[] = [];
  const tech: string[] = [];
  Object.keys(TECH_SYNONYMS).forEach(technology => {
    if (stringsContain([technology, ...TECH_SYNONYMS[technology]], input)) {
      tech.push(technology);
      related.push(technology, ...TECH_SYNONYMS[technology]);
    }
  });

  tech.forEach(technology => {
    TECH_DEPENDENCIES[technology]?.forEach(dependency => {
      related.push(dependency, ...getRelatedStrings(dependency));
    });
  });

  return Array.from(new Set(related));
}

export function getRelatedTech(technologies: string[]): string[] {
  const related: string[] = [];
  technologies.forEach(technology => {
    related.push(technology);
    const dependencies = TECH_DEPENDENCIES[technology];
    if (dependencies) {
      related.push(...getRelatedTech(dependencies));
    }
  });

  return Array.prototype.concat(...related.map(tech => [tech, ...(TECH_SYNONYMS[tech] || [])]));
}

export function stringsContain(strings: string[], substring: string) {
  for (const string of strings) {
    if (string.toLowerCase().includes(substring.toLowerCase())) {
      return true;
    }
  }

  return false;
}

export function processParagraph(paragraph: string) {
  if (/^=.+=$/.test(paragraph)) {
    // insert headers
    const header = paragraph.match(/=(.+)=/) || [];
    return <h5 key={header[1]}>{header[1]}</h5>
  } else if (/^- .+$/.test(paragraph)) {
    // insert bullets
    const bullet = paragraph.match(/- (.+)/) || [];
    return <ul key={bullet[1]}><li>{bullet[1]}</li></ul>
  } else {
    // insert links
    return <p>{paragraph.split(/(\([^\)]+\)\[[^\]]+\])/).map(segment => {
      if (/\([^\)]+\)\[[^\]]+\]/.test(segment)) {
        const text = segment.match(/\(([^\)]+)\)/) || [];
        const link = segment.match(/\[([^\]]+)\]/) || [];
        return <a href={link[1]}>{text[1]}</a>;
      }
      return segment;
    })}</p>
  }
}

export function toDownloadLink(link: string) {
  const parts = link.match(/\/d\/([^\/]+)\/view/) as string[];
  if (!parts) {
    return link;
  }
  https://lh3.googleusercontent.com/d/1QMB-Dw8Lf-U1raDzSS_p_09l71cFe7V2=w800?authuser=0
  return 'https://lh3.googleusercontent.com/d/FILEID=w800?authuser=0'.replace('FILEID', parts[1]);
}

export function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export const encrypt = (salt: any, text: string) => {
  const textToChars = (text: string) => text.split("").map((c: string) => c.charCodeAt(0));
  const byteHex = (n: any) => ("0" + Number(n).toString(16)).substr(-2);
  const applySaltToChar = (code: any) => textToChars(salt).reduce((a: number, b: number) => a ^ b, code);

  return text
    .split("")
    .map(textToChars)
    .map(applySaltToChar)
    .map(byteHex)
    .join("");
};

export const decrypt = (salt: any, encoded: any) => {
  const textToChars = (text: string) => text.split("").map((c: string) => c.charCodeAt(0));
  const applySaltToChar = (code: any) => textToChars(salt).reduce((a: number, b: number) => a ^ b, code);
  return encoded
    .match(/.{1,2}/g)
    .map((hex: string) => parseInt(hex, 16))
    .map(applySaltToChar)
    .map((charCode: number) => String.fromCharCode(charCode))
    .join("");
};
