// Reference solution: one ensureCapacity for the whole block, then a single
// forward copy of k elements — O(k) work and at most one reallocation.
//
// Three details carry the problem:
//   * k is clamped to mSize first, so "more than the stack holds" means
//     "all of it" instead of an index that wrapped around;
//   * the capacity is secured BEFORE any element is read. The obvious
//     alternative — a loop of push(mData[base + i]) — hands push a
//     REFERENCE into the very array push may reallocate, which leaves the
//     reference dangling mid-loop;
//   * the copy runs forward from the bottom of the block, so the source
//     range [mSize - k, mSize) and the destination range [mSize, mSize + k)
//     never overlap and the duplicated block keeps its original order.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::mitosis(size_t k)
{
  // Your code here
  if (k > mSize)
    k = mSize;
  if (k == 0)
    return;
  ensureCapacity(mSize + k);
  const size_t base = mSize - k;
  for (size_t i = 0; i < k; i++)
    mData[mSize + i] = mData[base + i];
  mSize += k;
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
