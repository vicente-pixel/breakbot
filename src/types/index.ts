export interface ViewportSize {
  width: number;
  height: number;
  name: string;
}

export interface Screenshot {
  viewport: ViewportSize;
  dataUrl: string;
  timestamp: number;
}

export interface LayoutIssue {
  type: 'overflow' | 'overlap' | 'broken-grid' | 'text-truncation' | 'spacing' | 'alignment' | 'other';
  description: string;
  affectedViewports: string[];
  breakpointRange: {
    from: number;
    to: number;
  };
  severity: 'low' | 'medium' | 'high';
  selector?: string;
}

export interface TailwindFix {
  issue: LayoutIssue;
  currentClasses?: string;
  suggestedClasses: string;
  explanation: string;
  codeSnippet: string;
}

export interface TestResult {
  id: string;
  url: string;
  screenshots: Screenshot[];
  issues: LayoutIssue[];
  fixes: TailwindFix[];
  testedAt: string;
  status: 'pending' | 'capturing' | 'analyzing' | 'complete' | 'error';
  error?: string;
}

export interface ApiKeyConfig {
  anthropicKey: string;
}
