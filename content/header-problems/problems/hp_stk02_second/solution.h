// Reference solution: the top lives in mData[mSize - 1], so the element just
// below it is mData[mSize - 2] — O(1), and const, so nothing is mutated.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::second() const
{
  // Your code here
  return mData[mSize - 2];
}

#endif
