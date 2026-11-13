// Reference solution: k counts DOWN from the top, while mData is indexed UP
// from the bottom, so the two indices mirror each other around mSize - 1.
// k = 0 is the top (mSize - 1) and k = mSize - 1 is the bottom (0).
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::at(size_t k) const
{
  // Your code here
  return mData[mSize - 1 - k];
}

#endif
