// Stands in for Vite `?worker` imports (`import W from './x.worker?worker'`) under Jest.
class WorkerStub {
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}

module.exports = WorkerStub;
module.exports.default = WorkerStub;
