import { test, expect } from '@playwright/test'

test('create and edit agents, save on switch, validate and call the selected graph', async ({ page }) => {
  const started: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ready', voice_configured: true } }))
  await page.route('**/start', async route => { started.push(route.request().postDataJSON().body.agent_id); await route.fulfill({ json: { sessionId: 'stub' } }) })
  await page.route('**/src/callClient.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function createCallClient(callbacks) { return {
      async startBotAndConnect(params) {
        await fetch(params.endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params.requestData)});
        callbacks.onBotReady?.({});
        callbacks.onUserTranscript?.({text:'Hello there',final:false,timestamp:'1'});
        callbacks.onUserTranscript?.({text:'Hello there',final:true,timestamp:'1'});
        callbacks.onUserTranscript?.({text:'Hello there',final:true,timestamp:'1'});
        callbacks.onUserTranscript?.({text:'I need help',final:true,timestamp:'2'});
        callbacks.onBotOutput?.({text:'Welcome to your agent.',segment_id:1});
        callbacks.onUserTranscript?.({text:'Thanks',final:true,timestamp:'3'});
        callbacks.onUserTranscript?.({text:'for your help.',final:true,timestamp:'4'});
        callbacks.onBotOutput?.({text:'Welcome to your agent.',segment_id:1,spoken_status:'completed'});
      }, async disconnect() { callbacks.onDisconnected?.(); }, enableMic() {}
    }; }
  ` }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Create agent', exact: true }).click()
  await page.getByLabel('Rename agent').fill('First agent')
  const firstId = new URL(page.url()).pathname.split('/').pop()!
  await page.getByRole('button', { name: 'Add step', exact: true }).first().click()
  await page.getByLabel('Node name', { exact: true }).fill('welcome')
  await page.getByLabel('Conversation instructions').fill('Greet the caller and ask their name.')
  await page.getByRole('button', { name: 'Add transition', exact: true }).click()
  await page.getByLabel('When should this transition happen?').fill('When the caller gives their name.')
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await page.getByLabel('Field name field', { exact: true }).fill('caller_name')
  await page.getByLabel('When should this transition happen?').click()
  await page.getByRole('button', { name: 'Add end step', exact: true }).click()
  await page.getByLabel('Conversation instructions').fill('Say goodbye to the caller by name.')
  await page.getByRole('banner').getByRole('button', { name: 'Test call', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Choose an existing destination node.' })).toBeVisible()
  expect(started).toHaveLength(0)
  await page.getByRole('button', { name: 'Choose an existing destination node.' }).click()
  await page.getByLabel('Go to step').selectOption('end')
  await page.getByRole('banner').getByRole('button', { name: 'Test call', exact: true }).click()
  await expect(page.getByLabel('Live transcript')).toContainText('Welcome to your agent.')
  await expect(page.getByLabel('Live transcript').getByText('Hello there I need help', { exact: true })).toHaveCount(1)
  await expect(page.getByLabel('Live transcript').getByText('Thanks for your help.', { exact: true })).toHaveCount(1)
  await expect(page.getByLabel('Live transcript').getByText('Welcome to your agent.', { exact: true })).toHaveCount(1)
  await expect(page.getByLabel('Live transcript').locator('p')).toHaveCount(3)
  expect(started).toEqual([firstId])
  await page.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()
  await page.getByRole('button', { name: 'End call', exact: true }).click()
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  await page.getByLabel('Rename agent').fill('Second agent')
  const secondId = new URL(page.url()).pathname.split('/').pop()!
  await page.getByRole('button', { name: 'Add end step', exact: true }).click()
  await page.getByLabel('Conversation instructions').fill('Say hello from the second agent, then goodbye.')
  // Switching automatically saves this draft without a confirmation prompt.
  await page.getByRole('navigation', { name: 'Agents' }).getByRole('button', { name: 'First agent', exact: true }).click()
  await expect(page.getByLabel('Rename agent')).toHaveValue('First agent')
  await page.reload()
  await expect(page.getByLabel('Rename agent')).toHaveValue('First agent')
  await expect(page.getByText('welcome', { exact: true }).first()).toBeVisible()
  await page.getByRole('navigation', { name: 'Agents' }).getByRole('button', { name: 'Second agent', exact: true }).click()
  await expect(page.getByLabel('Rename agent')).toHaveValue('Second agent')
  await page.getByRole('banner').getByRole('button', { name: 'Test call', exact: true }).click()
  await expect(page.getByLabel('Live transcript')).toContainText('Welcome to your agent.')
  expect(started).toEqual([firstId, secondId])
  await page.screenshot({ path: 'test-results/agent-editor.png', fullPage: true })
  expect(errors).toEqual([])
})
