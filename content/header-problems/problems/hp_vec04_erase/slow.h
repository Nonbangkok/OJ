// Deliberately naive reference: correct, but every erase allocates a fresh
// buffer, copies the surviving elements into it and throws the old one away,
// instead of shifting in place.
//
// meta.json sets "has_tle_subtask": false, and that is the honest call:
// erasing from an array-backed vector costs Theta(n - pos) however you write
// it, so this version differs from the reference by a constant factor (one
// allocation and one zero-initialising pass per call), not by a complexity
// class. The large subtask buys scale and the awkward positions (0, the last
// element, exactly mSize, far past the end), not a complexity separation.
//
// It is kept CORRECT, mCap included, so capacity() still reports what
// push_back produced.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::erase(size_t pos)
{
  if (pos >= mSize)
  {
    return;
  }
  size_t room = mCap > 0 ? mCap : 1;
  T *arr = new T[room]();
  size_t write = 0;
  for (size_t i = 0; i < mSize; i++)
  {
    if (i == pos)
    {
      continue;
    }
    arr[write] = mData[i];
    write++;
  }
  delete[] mData;
  mData = arr;
  mSize = write;
}

#endif
