// Reference solution: one pass over the mSize elements that are actually in
// the vector. mSize and mCap are untouched, so size(), capacity() and the
// copy operations keep behaving exactly as the header promises, and an empty
// vector is a no-op for free.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::fill(const T &value)
{
  // Your code here
  for (size_t i = 0; i < mSize; i++)
  {
    mData[i] = value;
  }
}

#endif
