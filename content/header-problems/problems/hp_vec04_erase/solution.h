// Reference solution: shift everything after `pos` one place to the left and
// drop the size by one. The out-of-range test comes first, both because the
// problem says such a call is a no-op and because mSize-- on an empty vector
// would wrap around (mSize is unsigned) and destroy the whole object.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::erase(size_t pos)
{
  // Your code here
  if (pos >= mSize)
  {
    return;
  }
  for (size_t i = pos + 1; i < mSize; i++)
  {
    mData[i - 1] = mData[i];
  }
  mSize--;
}

#endif
