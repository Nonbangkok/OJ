// Reference solution: `aux` holds the INDEX of the smallest element, so
// min() is one indexed read and never touches the rest of the array.
//
// Why an index and not a value: aux is an int, while T can be a string or a
// long long, so the minimum itself cannot live there — but a position can,
// and mData already holds the element.
//
// Where the work goes:
//   * push compares the newcomer against the current minimum only — O(1).
//     The comparison is STRICT, so with equal values aux keeps pointing at
//     the deeper one, which is the one that survives longer;
//   * pop is O(1) unless it removes the element aux points at, and only
//     then does it look for the new minimum. That is the "restore the
//     previous minimum" part of the task, and it is the one operation the
//     statement allows to cost O(size);
//   * expand() keeps the elements at the same indices and leaves aux alone,
//     and the copy constructor / copy assignment carry aux with the data, so
//     a copied stack answers min() correctly without being rescanned.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::min() const
{
  // Your code here
  return mData[aux];
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
  if (mSize == 0 || element < mData[aux])
    aux = static_cast<int>(mSize);
  mData[mSize] = element;
  mSize++;
}

template <typename T>
void CP::stack<T>::pop()
{
  // You MAY need to edit this function
  if (mSize == 0)
    return;
  mSize--;
  if (static_cast<size_t>(aux) == mSize)
  {
    // The minimum just left: find the one below it again.
    aux = 0;
    for (size_t i = 1; i < mSize; i++)
      if (mData[i] < mData[aux])
        aux = static_cast<int>(i);
  }
}

#endif
