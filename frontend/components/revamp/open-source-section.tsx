import { OpenSource, type Stats, type Contributor } from '@/components/revamp/open-source'

async function getGithubStats(repository: string, githubToken?: string): Promise<Stats> {
  try {
    const [repoResponse, contributorsResponse] = await Promise.all([
      fetch(`https://api.github.com/repos/${repository}`, {
        ...(githubToken && {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            'Content-Type': 'application/json',
          },
        }),
        next: { revalidate: 3600 },
      }),
      fetch(`https://api.github.com/repos/${repository}/contributors`, {
        ...(githubToken && {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            'Content-Type': 'application/json',
          },
        }),
        next: { revalidate: 3600 },
      }),
    ])

    if (!repoResponse.ok || !contributorsResponse.ok) {
      return { stars: 0, contributors: [] }
    }

    const repoData = await repoResponse.json()
    const contributorsData = await contributorsResponse.json()

    return {
      stars: repoData.stargazers_count,
      contributors: contributorsData as Contributor[],
    }
  } catch (error) {
    return { stars: 0, contributors: [] }
  }
}

export async function OpenSourceSection() {
  const stats = await getGithubStats('CubeStar1/paper-pilot', process.env.GITHUB_TOKEN)

  return (
    <OpenSource
      repository="CubeStar1/paper-pilot"
      title="Proudly open-source"
      description="Our source code is available on GitHub - feel free to read, review, or contribute to it however you want!"
      buttonText="Star on GitHub"
      defaultStats={stats}
    />
  )
}
