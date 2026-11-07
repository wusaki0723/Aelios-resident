// The paired machine on the settings page (src/machine.ts; the runner is in Aelios-desktop): a one-time pairing code for the runner, whether
// it is online, and revoking it. app.js mixes this into the page's state.
function machinePage() {
  return {
    machine: { loaded: false, machine: null, code: '', expiresAt: 0, busy: false, error: '' },
    async loadMachine() {
      try {
        var data = await this.api('/web/runner');
        this.machine = Object.assign({}, this.machine, { loaded: true, machine: data.machine, error: '' });
      } catch (error) { this.machine.error = error.message; }
    },
    async machineCode() {
      this.machine.busy = true; this.machine.error = '';
      try {
        var data = await this.api('/web/runner/code', { method: 'POST', body: {} });
        this.machine.code = data.code; this.machine.expiresAt = data.expiresAt;
        this.watchPairing();
      } catch (error) { this.machine.error = error.message; }
      this.machine.busy = false;
    },
    // After a code is made, look again every few seconds until the machine is there or the code has run out.
    watchPairing() {
      var self = this;
      clearInterval(this.machine.timer);
      this.machine.timer = setInterval(async function () {
        if (!self.machine.code || Date.now() > self.machine.expiresAt + 30000) { clearInterval(self.machine.timer); return; }
        await self.loadMachine();
        if (self.machine.machine && self.machine.machine.online) { clearInterval(self.machine.timer); self.machine.code = ''; }
        else if (!self.machine.code) clearInterval(self.machine.timer);
      }, 3000);
    },
    async machineRevoke() {
      if (!this.machine.machine || !confirm('撤销这台机器？它正在干的会停下，排着的不再做。')) return;
      this.machine.busy = true; this.machine.error = '';
      try {
        await this.api('/web/runner/revoke', { method: 'POST', body: { runnerId: this.machine.machine.id } });
        this.machine.code = '';
        await this.loadMachine();
      } catch (error) { this.machine.error = error.message; }
      this.machine.busy = false;
    },
    machineState() {
      var m = this.machine.machine;
      if (!m) return '还没配';
      return m.label + (m.online ? ' · 在线' : ' · 不在线' + (m.lastSeenAt ? '（上次 ' + this.fmt(m.lastSeenAt) + '）' : '（还没连上过）'));
    },
    machineCommand() {
      var resident = this.resident && this.resident !== 'default' ? ' --resident ' + this.resident : '';
      return 'aelios-runner pair --code ' + this.machine.code + ' --url ' + location.origin + resident + ' --workspace ~/aelios-work --plugin kiro';
    }
  };
}
