// Small, DOM-independent contract shared by the original Resident UI and its desktop shell.
(function (root) {
  var ID = /^[a-z][a-z0-9-]{0,23}$/;
  function enabled(bridge) { return Boolean(bridge && bridge.protocol === 'resident-dsh/1' && typeof bridge.request === 'function'); }
  function residentId(value) {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error('住户代号不正确');
    return value;
  }
  function origin(bridge, fallback) {
    if (!enabled(bridge)) return fallback;
    var value = new URL(bridge.origin);
    var loopback = ['localhost', '127.0.0.1', '[::1]'].indexOf(value.hostname) !== -1;
    if ((value.protocol !== 'https:' && !(loopback && value.protocol === 'http:')) || value.username || value.password || value.search || value.hash || value.pathname !== '/') throw new Error('桌面住民地址不正确');
    return value.origin;
  }
  function openPayload(resident, task) {
    if (!task || task.runs !== 'desktop') throw new Error('这不是本机 DSH 任务');
    var id = task.desktopJobId || task.lastJobId || task.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('任务代号不正确');
    return { resident: residentId(resident), jobId: id };
  }
  async function open(bridge, resident, task) {
    if (!enabled(bridge)) throw new Error('请在原设备的 DSH 中查看执行过程');
    // The parent resolves its trusted job/session mapping; never send a session ID or path.
    return bridge.request('helper.open', openPayload(resident, task));
  }
  root.ResidentDesktopUI = Object.freeze({ enabled: enabled, residentId: residentId, origin: origin, openPayload: openPayload, open: open });
})(globalThis);
