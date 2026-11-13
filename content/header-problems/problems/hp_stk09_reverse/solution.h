// Reference solution: reverse() flips one bit, and every other member reads
// the stack through that bit.
//
// The representation. The elements live in a WINDOW of the array,
// mData[lo .. lo + mSize - 1], and aux carries two numbers at once:
//
//     aux = 2 * lo + flip
//
//   * flip == 0: the window reads bottom-to-top left to right, so the top is
//     at lo + mSize - 1 and a push appends on the right;
//   * flip == 1: the window reads the other way, so the top is at lo and a
//     push has to prepend on the LEFT, which is why lo exists at all.
//
// Why a window, and why push does its own allocation. A plain stack keeps its
// elements at [0, mSize) and that is exactly what the class's expand() /
// ensureCapacity() assume: they copy the first mSize slots of the old array
// into the first mSize slots of the new one. Once the data starts somewhere
// else they would corrupt it, so they are unusable here and push grows mData
// itself.
//
// Why it is O(1) amortized. When the end being pushed to runs out of room,
// push re-centres the window — in a twice-as-large array if the current one
// is more than half full. A re-centre costs O(mSize) but leaves Omega(mSize)
// free slots at BOTH ends, so Omega(mSize) pushes fit before the next one.
// pop never needs room: it just moves the window's edge inward.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::reverse()
{
  // Your code here
  aux = aux ^ 1;
}

template <typename T>
const T &CP::stack<T>::top() const
{
  // You MAY need to edit this function
  const size_t lo = static_cast<size_t>(aux) >> 1;
  if (aux & 1)
    return mData[lo];
  return mData[lo + mSize - 1];
}

template <typename T>
void CP::stack<T>::push(const T &element)
{
  // You MAY need to edit this function
  const T value = element;
  size_t lo = static_cast<size_t>(aux) >> 1;
  const int flip = aux & 1;
  const bool at_front = (flip != 0);

  const bool blocked = at_front ? (lo == 0) : (lo + mSize >= mCap);
  if (blocked)
  {
    size_t capacity = mCap;
    if (mSize + 1 > mCap / 2)
      capacity = 2 * mCap + 2;
    T *arr = new T[capacity]();
    const size_t base = (capacity - mSize) / 2;
    for (size_t i = 0; i < mSize; i++)
      arr[base + i] = mData[lo + i];
    delete[] mData;
    mData = arr;
    mCap = capacity;
    lo = base;
  }

  if (at_front)
  {
    lo--;
    mData[lo] = value;
  }
  else
  {
    mData[lo + mSize] = value;
  }
  mSize++;
  aux = static_cast<int>(2 * lo) + flip;
}

template <typename T>
void CP::stack<T>::pop()
{
  // You MAY need to edit this function
  if (mSize == 0)
    return;
  size_t lo = static_cast<size_t>(aux) >> 1;
  const int flip = aux & 1;
  if (flip)
    lo++; // the top is the window's left edge, so the window shrinks there
  mSize--;
  aux = static_cast<int>(2 * lo) + flip;
}

#endif
