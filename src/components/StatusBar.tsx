import React, { useRef } from 'react'
import { Box, Text } from 'ink'
import { execSync } from 'child_process'
import { AppConfig } from '../shared/types'

interface Props {
  config: AppConfig
  cwd: string
  agentStatus: 'idle' | 'running' | 'thinking' | 'error'
  tokenCount: number
  mode?: 'build' | 'plan'
}

const HOME = process.env.HOME || process.env.USERPROFILE || ''

function getGitBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 800,
    }).toString().trim()
  } catch { return '' }
}

const AGENT_COLOR: Record<string, string> = {
  idle: '', running: '#1D4ED8', thinking: '#92400E', error: '#7F1D1D',
}
const AGENT_LABEL: Record<string, string> = {
  idle: '', running: 'RUNNING', thinking: 'THINKING', error: 'ERROR',
}

export const StatusBar: React.FC<Props> = ({ config, cwd, agentStatus, tokenCount, mode = 'build' }) => {
  const branchRef = useRef('')
  const lastCwdRef = useRef('')
  if (lastCwdRef.current !== cwd) {
    lastCwdRef.current = cwd
    branchRef.current = getGitBranch(cwd)
  }

  const cwdDisplay = cwd.startsWith(HOME) ? cwd.replace(HOME, '~') : cwd
  const branch = branchRef.current

  return (
    <Box justifyContent="space-between">
      {/* Left: app name + version + cwd + branch */}
      <Box>
        <Text bold color="#60A5FA">localcode </Text>
        <Text color="#374151">v0.1.10  </Text>
        <Text color="#6B7280">{cwdDisplay}</Text>
        {branch && <Text color="#4B5563"> ({branch})</Text>}
        {tokenCount > 0 && <Text color="#374151">  ~{tokenCount}t</Text>}
      </Box>

      {/* Right: agent status + mode badge */}
      <Box>
        {AGENT_LABEL[agentStatus] && (
          <Text backgroundColor={AGENT_COLOR[agentStatus]} color="#BFDBFE"> {AGENT_LABEL[agentStatus]} </Text>
        )}
        <Text color="#374151">  tab  </Text>
        <Text
          backgroundColor={mode === 'plan' ? '#166534' : '#1D4ED8'}
          color={mode === 'plan' ? '#86EFAC' : '#BFDBFE'}
        > {mode === 'plan' ? 'PLAN MODE' : 'BUILD MODE'} </Text>
      </Box>
    </Box>
  )
}
