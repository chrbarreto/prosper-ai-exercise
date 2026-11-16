import { PipecatClient, type RTVIEventCallbacks } from '@pipecat-ai/client-js'
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport'

export function createCallClient(callbacks: RTVIEventCallbacks) {
  return new PipecatClient({ transport: new SmallWebRTCTransport(), enableMic: true, enableCam: false, callbacks })
}
