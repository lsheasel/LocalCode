import React from 'react'
import { Box, Text } from 'ink'
import { AppConfig } from '../shared/types'
import { getAppVersion } from '../shared/version'

interface Props {
  config: AppConfig
  cwd: string
}

const HOME = process.env.HOME || process.env.USERPROFILE || ''
const SEP = '─'
const APP_VERSION = getAppVersion()

export const Header: React.FC<Props> = ({ config, cwd }) => {
  const cols = process.stdout.columns || 80
  const modelLabel = `${config.llm.provider}/${config.llm.model}`
  const cwdDisplay = (cwd.startsWith(HOME) ? cwd.replace(HOME, '~') : cwd).slice(-30)
  const line = SEP.repeat(cols)

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="#3B82F6"> ⚡ LocalCode </Text>
        <Text color="#1E3A8A">│ </Text>
        <Text color="#374151">{`v${APP_VERSION}`} </Text>
        <Text color="#1E3A8A">│ </Text>
        <Text color="#6B7280">🤖 {modelLabel} </Text>
        <Text color="#1E3A8A">│ </Text>
        <Text color="#6B7280">📂 {cwdDisplay}</Text>
      </Box>
      <Text color="#1E3A8A">{line}</Text>
    </Box>
  )
}
