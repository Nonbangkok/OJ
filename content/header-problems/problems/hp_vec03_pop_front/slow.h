// Deliberately naive reference: correct, but every pop_front allocates a
// fresh buffer, copies the surviving elements into it and throws the old one
// away, instead of shifting in place.
//
// meta.json sets "has_tle_subtask": false, and that is the honest call here:
// removing the front element of an array-backed vector is Theta(n) however
// you write it, so this version differs from the reference by a constant
// factor (an allocation and a zero-initialising pass per call), not by a
// complexity class. The large subtask therefore buys scale — a hundred
// thousand elements, three element types, capacity printed after every
// append — rather than a complexity separation.
//
// It is kept CORRECT, including keeping mCap unchanged so that capacity()
// still reports what push_back produced.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::pop_front()
{
  if (mSize == 0)
  {
    return;
  }
  size_t room = mCap > 0 ? mCap : 1;
  T *arr = new T[room]();
  for (size_t i = 1; i < mSize; i++)
  {
    arr[i - 1] = mData[i];
  }
  delete[] mData;
  mData = arr;
  mSize--;
}

#endif
