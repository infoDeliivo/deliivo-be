const Sequencer = require('@jest/test-sequencer').default;

class NumericSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => {
      const numA = parseInt(a.path.match(/(\d+)-/)?.[1] || '0', 10);
      const numB = parseInt(b.path.match(/(\d+)-/)?.[1] || '0', 10);
      return numA - numB;
    });
  }
}

module.exports = NumericSequencer;
