// Reference solution: one left shift of the remaining mSize - 1 elements,
// then mSize goes down by one. mData and mCap are untouched, so capacity()
// stays exactly where push_back left it, and an empty vector returns
// immediately instead of underflowing mSize (mSize is unsigned: mSize-- on
// zero would wrap to the maximum size_t and corrupt every later operation).
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::pop_front()
{
  // Your code here
  if (mSize == 0)
  {
    return;
  }
  for (size_t i = 1; i < mSize; i++)
  {
    mData[i - 1] = mData[i];
  }
  mSize--;
}

#endif
