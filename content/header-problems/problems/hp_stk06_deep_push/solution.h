// Reference solution: deep_push shifts exactly the k elements that have to
// end up above the new one, so it costs O(k) — not O(size) — and push, pop
// and top can stay exactly as they were.
//
// Three details carry the problem:
//   * k is clamped to mSize, so "deeper than the stack" means "the bottom"
//     instead of an index that wrapped around;
//   * `element` is copied into a local BEFORE anything moves. The grader
//     calls deep_push(k, top()), so the reference may point into mData —
//     both ensureCapacity (which reallocates) and the shifting loop (which
//     overwrites) would otherwise destroy the value before it is stored;
//   * the shift runs downwards (from the top towards pos), so each element
//     is copied into a slot that has already been vacated.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::deep_push(size_t k, const T &element)
{
  // Your code here
  const T value = element;
  if (k > mSize)
    k = mSize;
  ensureCapacity(mSize + 1);
  const size_t pos = mSize - k;
  for (size_t i = mSize; i > pos; i--)
    mData[i] = mData[i - 1];
  mData[pos] = value;
  mSize++;
}

template <typename T>
const T &CP::stack<T>::top() const
{
  // You MAY need to edit this function
  return mData[mSize - 1];
}

template <typename T>
void CP::stack<T>::push(const T &element)
{
  // You MAY need to edit this function
  ensureCapacity(mSize + 1);
  mData[mSize] = element;
  mSize++;
}

template <typename T>
void CP::stack<T>::pop()
{
  // You MAY need to edit this function
  if (mSize > 0)
    mSize--;
}

#endif
