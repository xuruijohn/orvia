import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertAcyclicGraph,
  effectiveWorkflowNodeId,
  graphIsComplete,
  plannedTaskStatus,
  reachableFromRoots,
  selectRunnableTask,
  selectRunnableTasks,
} from '../src/application/task-graph.js';

test('task graph releases a node only after all dependencies complete', () => {
  const tasks = [
    { id: 1, workflowNodeId: 10, status: 'completed', inputJson: {} },
    { id: 2, workflowNodeId: 20, status: 'blocked', inputJson: { dependsOnNodeIds: [10] } },
    { id: 3, workflowNodeId: 30, status: 'blocked', inputJson: { dependsOnNodeIds: [20] } },
  ];
  assert.equal(selectRunnableTask(tasks)?.id, 2);
  assert.equal(graphIsComplete(tasks), false);
});

test('task graph reports completion with completed and cancelled leaves', () => {
  assert.equal(graphIsComplete([
    { id: 1, workflowNodeId: 10, status: 'completed', inputJson: {} },
    { id: 2, workflowNodeId: 20, status: 'cancelled', inputJson: {} },
  ]), true);
});

test('ready tasks include every independent branch and honor task dependencies', () => {
  const tasks = [
    { id: 1, workflowNodeId: 10, status: 'pending', inputJson: {} },
    { id: 2, workflowNodeId: 20, status: 'pending', inputJson: {} },
    { id: 3, workflowNodeId: null, status: 'blocked', inputJson: { dependsOnTaskIds: [1] } },
  ];
  assert.deepEqual(selectRunnableTasks(tasks).map((task) => task.id), [1, 2]);
  tasks[0]!.status = 'completed';
  assert.deepEqual(selectRunnableTasks(tasks).map((task) => task.id), [2, 3]);
});

test('runnable tasks still resolve deps when workflowNodeId column was cleared after board save', () => {
  const tasks = [
    { id: 1, workflowNodeId: null, status: 'completed', inputJson: { workflowNodeId: 10, nodeType: 'start' } },
    { id: 2, workflowNodeId: null, status: 'pending', inputJson: { workflowNodeId: 20, nodeType: 'task', dependsOnNodeIds: [10] } },
    { id: 3, workflowNodeId: null, status: 'blocked', inputJson: { workflowNodeId: 30, nodeType: 'checkpoint', dependsOnNodeIds: [20] } },
  ];
  assert.deepEqual(selectRunnableTasks(tasks).map((task) => task.id), [2]);
});

test('effective workflow node id prefers the column value over the input snapshot', () => {
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: 7, inputJson: { workflowNodeId: true } }), 7);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: 7, inputJson: { workflowNodeId: 20 } }), 7);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: 0, inputJson: { workflowNodeId: 20 } }), 0);
});

test('effective workflow node id falls back to positive safe integers from the input snapshot', () => {
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId: 20 } }), 20);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId: Number.MAX_SAFE_INTEGER } }), Number.MAX_SAFE_INTEGER);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId: '20' } }), 20);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId: ' 20 ' } }), 20);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId: '020' } }), 20);
});

test('effective workflow node id rejects non-numeric, non-integer and unsafe fallbacks', () => {
  const invalid = [
    true,
    false,
    [20],
    { value: 20 },
    '',
    '   ',
    0,
    -5,
    1.5,
    '1.5',
    '1e2',
    'abc',
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '99999999999999999999',
  ];
  for (const workflowNodeId of invalid) {
    assert.equal(
      effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: { workflowNodeId } }),
      null,
      `workflowNodeId=${String(workflowNodeId)}`,
    );
  }
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: {} }), null);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: null }), null);
  assert.equal(effectiveWorkflowNodeId({ workflowNodeId: null, inputJson: [20] }), null);
});

test('runnable tasks ignore boolean and array snapshot ids instead of coercing them', () => {
  const tasks = [
    { id: 1, workflowNodeId: null, status: 'completed', inputJson: { workflowNodeId: true } },
    { id: 2, workflowNodeId: null, status: 'blocked', inputJson: { workflowNodeId: [20], dependsOnNodeIds: [1] } },
  ];
  assert.deepEqual(selectRunnableTasks(tasks).map((task) => task.id), []);
});

test('workflow graph rejects cycles and unknown nodes', () => {
  assert.doesNotThrow(() => assertAcyclicGraph(['a', 'b'], [{ source: 'a', target: 'b' }]));
  assert.throws(() => assertAcyclicGraph(['a', 'b'], [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ]));
  assert.throws(() => assertAcyclicGraph(['a'], [{ source: 'a', target: 'missing' }]));
});

test('only nodes reachable from start can be planned to run', () => {
  const reachable = reachableFromRoots(
    [1, 2, 3, 4],
    [
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ],
    [1],
  );
  assert.deepEqual([...reachable].sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(plannedTaskStatus(1, [], reachable), 'pending');
  assert.equal(plannedTaskStatus(2, [1], reachable), 'blocked');
  assert.equal(plannedTaskStatus(4, [], reachable), 'cancelled');
});
