import React, { useState, useEffect } from 'react'
import { Text } from 'ink'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const ThinkingDots: React.FC<{ label?: string }> = ({ label = 'Thinking' }) => {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80)
    return () => clearInterval(t)
  }, [])

  return <Text color="#3B82F6">{FRAMES[frame]} {label}...</Text>
}
