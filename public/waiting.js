// The waiting list on the 线程 page (src/waiting.ts): what needs them, or has news, in one fixed format. It is read from
// its own endpoint and never touches the conversation. app.js mixes this into the page's state.
function waitingPage() {
  return {
    waiting: { items: [], open: 0 },
    async loadWaiting() {
      try { this.waiting = await this.api('/web/waiting'); } catch (error) { /* the threads below still work */ }
    },
    waitingKind(item) {
      return { ask: '等你', note: '进展', done: '做完了', stuck: '卡住了' }[item.kind] + (item.expired ? ' · 过期了' : '');
    },
    // An option goes the way a choice on a thread's card goes.
    async waitingAnswer(item, option) {
      if (this.choosing) return;
      this.choosing = item.task;
      try {
        await this.api('/web/task/choose', { method: 'POST', body: { id: item.task, text: option } });
        await this.loadWaiting();
      } catch (error) { this.notify(error.message); }
      this.choosing = '';
    },
    async waitingRead(item) {
      try { this.waiting = await this.api('/web/waiting/seen', { method: 'POST', body: item ? { id: item.id } : { all: true } }); } catch (error) { this.notify(error.message); }
    },
    waitingOpen(item) {
      if (item.kind !== 'ask') this.waitingRead(item);
      return this.openThread(item.thread);
    },
    async stopThread() {
      if (this.threadBusy) return;
      this.threadBusy = true;
      try {
        await this.api('/web/thread/stop', { method: 'POST', body: { id: this.thread.id } });
        this.notify('叫它停下了');
      } catch (error) { this.notify(error.message); }
      this.threadBusy = false;
    }
  };
}
