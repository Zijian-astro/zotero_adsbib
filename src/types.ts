export interface Paper {
  title: string;
  fields: Record<string, string>;
}

export interface Identifiers {
  bibcode?: string;
  doi?: string;
  arxiv?: string;
}

export interface ADSRecord {
  bibcode: string;
  doi?: string[];
  identifier?: string[];
  alternate_bibcode?: string[];
}

export interface Failure { title: string; reason: string }
export interface CopyResult {
  text: string;
  bibcodes: string[];
  failures: Failure[];
  duplicates: number;
}
