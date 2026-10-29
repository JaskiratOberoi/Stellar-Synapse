import { useState } from 'react'
import { Cloud, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { useAppStore } from '@/store/useAppStore'

/**
 * First-launch question: which lab is this? Shown until a lab name is saved.
 *
 * The name is what Stellar Infinity labels this install with in its
 * Interfacing tab, and saving it is what lets the install enrol itself — the
 * main process picks the new name up and asks Infinity for this site's
 * credential; nothing else needs typing. The dialog cannot be dismissed
 * without a name, because an unnamed install would sit invisible to the
 * people monitoring the fleet.
 */
export function LabIdentityDialog() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [labName, setLabName] = useState('')
  const [labLocation, setLabLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const open = !!settings && settings.labName.trim().length === 0
  const canSave = labName.trim().length >= 2 && !saving

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      const saved = await window.api.settings.save({
        labName: labName.trim(),
        labLocation: labLocation.trim()
      })
      setSettings(saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => undefined}
      title="Which lab is this?"
      description="Stellar Synapse reports its instruments to Stellar Infinity so every lab can be monitored centrally. Name this lab so Infinity knows how to label it."
      footer={
        <Button onClick={() => void save()} disabled={!canSave}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Cloud className="h-4 w-4" strokeWidth={1.75} />
          )}
          Connect to Infinity
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="lab-name">Lab name</Label>
          <Input
            id="lab-name"
            autoFocus
            value={labName}
            placeholder="e.g. Noble Diagnostic Center Srinagar"
            onChange={(e) => setLabName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-location">Location</Label>
          <Input
            id="lab-location"
            value={labLocation}
            placeholder="City or site, e.g. Srinagar"
            onChange={(e) => setLabLocation(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This can be changed later under Settings. Interfacing with the analyzers is never
          affected by the cloud connection.
        </p>
      </form>
    </Modal>
  )
}
