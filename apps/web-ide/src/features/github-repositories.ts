export interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  updatedAt: string;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  ownerLogin: string;
}
