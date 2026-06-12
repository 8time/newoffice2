const fs = require('fs');

// 1. types/IOfficeState.ts
let iOfficeState = fs.readFileSync('types/IOfficeState.ts', 'utf8');
iOfficeState = iOfficeState.replace('isVideoOff: boolean', 'isVideoOff: boolean\n  isAudioMuted: boolean');
fs.writeFileSync('types/IOfficeState.ts', iOfficeState);

// 2. server/rooms/schema/OfficeState.ts
let officeState = fs.readFileSync('server/rooms/schema/OfficeState.ts', 'utf8');
officeState = officeState.replace('@type(\'boolean\') isVideoOff = false', '@type(\'boolean\') isVideoOff = false\n  @type(\'boolean\') isAudioMuted = false');
fs.writeFileSync('server/rooms/schema/OfficeState.ts', officeState);

// 3. types/Messages.ts
// Add UPDATE_MEDIA_STATUS if it doesn't exist
let messages = fs.readFileSync('types/Messages.ts', 'utf8');
if (!messages.includes('UPDATE_MEDIA_STATUS')) {
  messages = messages.replace('UPDATE_VIDEO_STATUS,', 'UPDATE_VIDEO_STATUS,\n  UPDATE_MEDIA_STATUS,');
  fs.writeFileSync('types/Messages.ts', messages);
}

// 4. server/rooms/SkyOffice.ts
let skyOffice = fs.readFileSync('server/rooms/SkyOffice.ts', 'utf8');
const mediaStatusHandler = 
    this.onMessage(Message.UPDATE_MEDIA_STATUS, (client, message: { isVideoOff: boolean; isAudioMuted: boolean }) => {
      const player = this.state.players.get(client.sessionId)
      if (player) {
        player.isVideoOff = message.isVideoOff
        player.isAudioMuted = message.isAudioMuted
      }
    })
;
if (!skyOffice.includes('UPDATE_MEDIA_STATUS')) {
  skyOffice = skyOffice.replace('this.onMessage(Message.UPDATE_VIDEO_STATUS,', mediaStatusHandler + '\n    this.onMessage(Message.UPDATE_VIDEO_STATUS,');
  fs.writeFileSync('server/rooms/SkyOffice.ts', skyOffice);
}

// 5. client/src/services/Network.ts
let network = fs.readFileSync('client/src/services/Network.ts', 'utf8');
if (!network.includes('updateMediaStatus')) {
  const method = 
  updateMediaStatus(isVideoOff: boolean, isAudioMuted: boolean) {
    this.room?.send(Message.UPDATE_MEDIA_STATUS, { isVideoOff, isAudioMuted })
  }
;
  network = network.replace('updateVideoStatus(isVideoOff: boolean)', method + '\n  updateVideoStatus(isVideoOff: boolean)');
  fs.writeFileSync('client/src/services/Network.ts', network);
}

console.log('Backend and Network files updated.');
