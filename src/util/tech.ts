// Names a technology goes by, and what knowing it implies, for searching projects.
export const TECH_SYNONYMS : { [key in string]: string[] } = {
  'JavaScript': ['JS'],
  'TypeScript': ['TS'],
  'React': ['ReactJS'],
  'Racket': ['ISL', 'Intermediate Student Language'],
  'Spring': ['Spring Boot', 'Spring Framework']
}

export const TECH_DEPENDENCIES: { [key in string]: string[] } = {
  'React Native': ['React', 'IOS', 'Android'],
  'React': ['Node', 'JavaScript'],
  'Node': ['npm'],
  'TypeScript': ['JavaScript'],
  'JavaScript': ['HTML', 'CSS'],
  'Java': ['Gradle', 'Maven'],
  'Spring': ['REST', 'Java', 'Jackson'],
  'Rust': ['cargo'],
  'Racket (Intermediate Student Language)': ['Racket']
}